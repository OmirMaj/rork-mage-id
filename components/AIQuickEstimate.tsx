import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, TextInput, ScrollView, ActivityIndicator, Animated, Platform, KeyboardAvoidingView,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import {
  X, ChevronRight, AlertTriangle,
  TrendingDown, Clock, MapPin, Ruler, Package, HardHat, Boxes,
  CheckCircle, DollarSign, Shield, ChevronDown, ChevronUp,
} from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import { nailIt } from '@/components/animations/NailItToast';
import { BrainCard } from '@/components/brain/BrainCard';
import { EMPTY_GROUNDING, groundingChipLabel, type GroundingBundle, type ScopeHints } from '@/utils/groundingChip';
import { Colors, type ThemeColors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { PROJECT_TYPES, type ProjectType, type QualityTier } from '@/types';
import { generateQuickEstimate, type AIQuickEstimateResult } from '@/utils/aiService';
import { checkAILimit, recordAIUsage } from '@/utils/aiRateLimiter';
import { showAILimitAlert } from '@/utils/aiLimitAlert';
import { useRouter } from 'expo-router';
import { useSubscription } from '@/contexts/SubscriptionContext';
import EstimateLoadingOverlay from '@/components/EstimateLoadingOverlay';
import type { MaterialItem } from '@/constants/materials';
import { LABOR_RATES, type LaborRate } from '@/constants/laborRates';
import { ASSEMBLIES, type AssemblyItem } from '@/constants/assemblies';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { showAlert } from '@/utils/alert';

interface CartItem {
  material: MaterialItem;
  quantity: number;
  markup: number;
  usesBulk: boolean;
  priceSource?: 'live' | 'base';
}

interface LaborCartItem {
  labor: LaborRate;
  hours: number;
  adjustedRate: number;
}

interface AssemblyCartItem {
  assembly: AssemblyItem;
  quantity: number;
  materialsCost: number;
  laborCost: number;
  totalCost: number;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  onApplyEstimate: (
    materials: CartItem[],
    labor: LaborCartItem[],
    assemblies: AssemblyCartItem[],
  ) => void;
  existingMaterials: MaterialItem[];
  globalMarkup: number;
  location: string;
  calculateAssemblyCost: (assembly: AssemblyItem, qty: number) => { materialsCost: number; laborCost: number; totalCost: number };
  /** PRODUCT-F18 / re-review A2: the grounding for ONE run, chosen from what
   *  is being priced. Called inside handleGenerate with the description and
   *  project type the model is about to see, so the owner (the estimator
   *  screen, which holds the cost book) can pick the entries that match THIS
   *  job — not the six largest in the book. The bundle that comes back is the
   *  prompt's grounding and the chip's counts, snapshotted next to the result
   *  so the chip cannot drift from the prompt if the book changes mid-call. */
  groundingFor?: (hints: ScopeHints) => GroundingBundle;
}

const QUALITY_TIERS: { id: QualityTier; label: string; desc: string }[] = [
  { id: 'economy', label: 'Economy', desc: 'Budget-friendly materials' },
  { id: 'standard', label: 'Standard', desc: 'Mid-range, reliable' },
  { id: 'premium', label: 'Premium', desc: 'High-end finishes' },
  { id: 'luxury', label: 'Luxury', desc: 'Top-tier everything' },
];

const QUICK_PROMPTS = [
  { label: 'Kitchen Remodel', prompt: 'Complete kitchen remodel with new cabinets, countertops, flooring, lighting, backsplash, and appliance prep', sqft: 150, type: 'remodel' as ProjectType },
  { label: 'Bathroom Remodel', prompt: 'Full bathroom remodel including new tile, vanity, toilet, shower/tub, plumbing fixtures, and lighting', sqft: 60, type: 'remodel' as ProjectType },
  { label: 'Basement Finish', prompt: 'Finish unfinished basement with framing, insulation, drywall, flooring, electrical, bathroom, and paint', sqft: 800, type: 'renovation' as ProjectType },
  { label: 'Deck Build', prompt: 'Build a new composite deck with railing, stairs, and post footings', sqft: 300, type: 'addition' as ProjectType },
  { label: 'Roof Replacement', prompt: 'Full roof tear-off and replacement with architectural shingles, underlayment, flashing, and ridge vents', sqft: 2000, type: 'roofing' as ProjectType },
  { label: 'Room Addition', prompt: 'Single room addition including foundation, framing, roofing, insulation, drywall, electrical, HVAC, and finishes', sqft: 200, type: 'addition' as ProjectType },
  { label: 'Whole House Paint', prompt: 'Interior paint for entire home — walls, ceilings, trim, 2 coats with primer', sqft: 2000, type: 'painting' as ProjectType },
  { label: 'Fence Install', prompt: 'Install 6ft wood privacy fence around backyard with one gate, posts, and staining', sqft: 0, type: 'landscape' as ProjectType },
];

export default React.memo(function AIQuickEstimate({
  visible, onClose, onApplyEstimate, existingMaterials, globalMarkup, location, calculateAssemblyCost,
  groundingFor,
}: Props) {
  // Built per theme: this sheet baked 13 distinct Colors.* getters at import —
  // background, surface, both text ranks, both fills, all three label inks —
  // so the whole estimator rendered light-on-light in dark mode
  // (audit 2026-09-07).
  const s = useThemedStyles(makeStyles);
  const { colors: t } = useTheme();
  const { tier } = useSubscription();
  const router = useRouter();
  const [step, setStep] = useState<'input' | 'loading' | 'result'>('input');
  const [description, setDescription] = useState('');
  const [projectType, setProjectType] = useState<ProjectType>('renovation');
  const [sqft, setSqft] = useState('');
  const [quality, setQuality] = useState<QualityTier>('standard');
  const [result, setResult] = useState<AIQuickEstimateResult | null>(null);
  // The grounding that went into the prompt behind `result` — the facts the
  // model was given and the MEASURED / STATED counts behind them. Set in
  // handleGenerate from the same bundle the call used; the chip reads this,
  // never a live prop, so it describes the prompt that was actually sent.
  const [resultGrounding, setResultGrounding] = useState<GroundingBundle | null>(null);
  const [expandedSection, setExpandedSection] = useState<string | null>('materials');
  const [error, setError] = useState<string | null>(null);

  const pulseAnim = useRef(new Animated.Value(0.4)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (step === 'loading') {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1, duration: 1000, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 0.4, duration: 1000, useNativeDriver: true }),
        ])
      ).start();
      Animated.timing(progressAnim, { toValue: 1, duration: 25000, useNativeDriver: false }).start();
    } else {
      pulseAnim.setValue(0.4);
      progressAnim.setValue(0);
    }
  }, [step, pulseAnim, progressAnim]);

  useEffect(() => {
    if (step === 'result') {
      Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }).start();
    } else {
      fadeAnim.setValue(0);
    }
  }, [step, fadeAnim]);

  const handleReset = useCallback(() => {
    setStep('input');
    setResult(null);
    setResultGrounding(null);
    setError(null);
    setExpandedSection('materials');
    setDescription('');
    setSqft('');
    setProjectType('renovation');
    setQuality('standard');
  }, []);

  const handleClose = useCallback(() => {
    handleReset();
    onClose();
  }, [handleReset, onClose]);

  const handleQuickPrompt = useCallback((prompt: typeof QUICK_PROMPTS[0]) => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setDescription(prompt.prompt);
    setSqft(prompt.sqft > 0 ? String(prompt.sqft) : '');
    setProjectType(prompt.type);
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!description.trim()) {
      showAlert('Describe Your Project', 'Tell us what you\'re building so AI can generate an accurate estimate.');
      return;
    }

    // Quick Estimate is gated as a high-value feature. Free tier gets 3
    // lifetime trials (so they can DEMO the magic), then must upgrade to
    // Pro. Pro/Business have it on the daily 'smart' quota.
    const limit = await checkAILimit(tier, 'smart', 'quickEstimate');
    if (!limit.allowed) {
      showAILimitAlert({ limit, router });
      return;
    }

    setStep('loading');
    setError(null);
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      // Grounding chosen for THIS job from what the model is about to see,
      // and snapshotted before the call so the chip describes this prompt
      // even if the cost book finishes loading (or changes) mid-call.
      const used = groundingFor ? groundingFor({ projectType, scope: description }) : EMPTY_GROUNDING;
      setResultGrounding(used);
      const data = await generateQuickEstimate(
        description,
        projectType,
        parseInt(sqft, 10) || 0,
        quality,
        location,
        used.facts,
      );
      // Set the result FIRST so the UI transitions out of the loading
      // screen immediately. recordAIUsage is best-effort AsyncStorage
      // bookkeeping and shouldn't gate the user seeing their estimate —
      // previously awaited, which extended perceived loading on slow
      // disk writes.
      setResult(data);
      setStep('result');
      void recordAIUsage('smart', 'quickEstimate');
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      nailIt('Estimate ready');
      console.log('[AI Quick Estimate] Success:', data.materials.length, 'materials');
    } catch (err) {
      // Surface the real error message so users + console can see WHY it
      // failed (timeout, no connection, edge function 5xx, etc) — was
      // previously masked behind a generic "Failed to generate estimate."
      // When user reports "AI doesn't give info anymore," the real
      // message in the banner is the fastest way to triage.
      console.error('[AI Quick Estimate] Error:', err);
      const reason = err instanceof Error && err.message ? err.message : 'Please try again.';
      setError(`Couldn't generate estimate. ${reason}`);
      setStep('input');
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }, [description, projectType, sqft, quality, location, tier, groundingFor]);

  const matchMaterial = useCallback((aiMat: { name: string; category: string; unit: string; unitPrice: number; supplier: string }) => {
    const nameLower = aiMat.name.toLowerCase();
    const catLower = aiMat.category.toLowerCase().replace(/[^a-z]/g, '');

    const exact = existingMaterials.find(m =>
      m.name.toLowerCase().includes(nameLower.split(' ').slice(0, 3).join(' ')) ||
      nameLower.includes(m.name.toLowerCase().split(' ').slice(0, 3).join(' '))
    );
    if (exact) return exact;

    const catMatch = existingMaterials.find(m =>
      m.category === catLower && m.name.toLowerCase().includes(nameLower.split(' ')[0])
    );
    if (catMatch) return catMatch;

    return null;
  }, [existingMaterials]);

  const handleApply = useCallback(() => {
    if (!result) return;
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

    const materialItems: CartItem[] = result.materials.map(aiMat => {
      const matched = matchMaterial(aiMat);
      const material: MaterialItem = matched ?? {
        id: `aiqe-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: aiMat.name,
        category: aiMat.category.toLowerCase().replace(/[^a-z]/g, '') || 'hardware',
        unit: aiMat.unit,
        baseRetailPrice: aiMat.unitPrice,
        baseBulkPrice: aiMat.unitPrice * 0.85,
        bulkMinQty: 10,
        // A CONSTANT, never `aiMat.supplier`. That field is model-filled and
        // its schema DEFAULTS to the string 'Home Depot' (utils/aiService.ts
        // :1113), with the same store named again in the prompt's worked
        // example (:1201) and in the offline fallback rows (:1223) — so a GC
        // who never saw a store name got one anyway. `supplier` rides this row
        // into the cart, into estimate line items (app/(tabs)/estimate/
        // review.tsx:185) and onto the bid PDF the client reads, which is how
        // "Home Depot" ended up beside a price nobody ever quoted
        // (audit 2026-09-07, money-trust). Matches the constant the materials
        // estimator settled on at app/(tabs)/estimate/full.tsx:441.
        supplier: 'AI estimate',
        pricingModel: 'market',
        sourceLabel: matched ? 'Matched' : 'AI estimate — not a supplier quote',
      };

      return {
        material,
        quantity: Math.max(1, Math.round(aiMat.quantity)),
        markup: globalMarkup,
        usesBulk: aiMat.quantity >= material.bulkMinQty,
      };
    });

    const laborItems: LaborCartItem[] = result.labor.map(aiLab => {
      const matched = LABOR_RATES.find(r =>
        r.trade.toLowerCase().includes(aiLab.trade.toLowerCase().split(' ')[0]) ||
        aiLab.trade.toLowerCase().includes(r.trade.toLowerCase().split(' ')[0])
      );

      return {
        labor: matched ?? {
          id: `aiqe-lab-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
          trade: aiLab.trade,
          category: 'general',
          hourlyRate: aiLab.hourlyRate,
          rateRange: { low: aiLab.hourlyRate * 0.8, high: aiLab.hourlyRate * 1.3 },
          unit: 'per hour',
          dailyOutput: 'AI estimated',
          crew: aiLab.crew || '1 Worker',
          wageType: 'open_shop' as const,
        },
        hours: Math.max(1, Math.round(aiLab.hours)),
        adjustedRate: matched?.hourlyRate ?? aiLab.hourlyRate,
      };
    });

    const assemblyItems: AssemblyCartItem[] = result.assemblies
      .map(aiAsm => {
        const matched = ASSEMBLIES.find(a =>
          a.name.toLowerCase().includes(aiAsm.name.toLowerCase().split('(')[0].trim().split(' ').slice(0, 3).join(' ')) ||
          aiAsm.name.toLowerCase().includes(a.name.toLowerCase().split('(')[0].trim().split(' ').slice(0, 3).join(' '))
        );
        if (!matched) return null;
        const costs = calculateAssemblyCost(matched, Math.max(1, Math.round(aiAsm.quantity)));
        return {
          assembly: matched,
          quantity: Math.max(1, Math.round(aiAsm.quantity)),
          ...costs,
        };
      })
      .filter((item): item is AssemblyCartItem => item !== null);

    onApplyEstimate(materialItems, laborItems, assemblyItems);
    handleClose();

    showAlert(
      'Estimate Generated',
      `Added ${materialItems.length} materials, ${laborItems.length} labor items, and ${assemblyItems.length} assemblies to your estimate.`,
    );
  }, [result, matchMaterial, globalMarkup, calculateAssemblyCost, onApplyEstimate, handleClose]);

  const estimatedTotals = useMemo(() => {
    if (!result) return { materials: 0, labor: 0, assemblies: 0, additional: 0, grand: 0 };
    const materials = (result.materials ?? []).reduce((s, m) => s + (m.unitPrice ?? 0) * (m.quantity ?? 0), 0);
    const labor = (result.labor ?? []).reduce((s, l) => s + (l.hourlyRate ?? 0) * (l.hours ?? 0), 0);
    const assemblies = (result.assemblies ?? []).length;
    const add = result.additionalCosts ?? { permits: 0, dumpsterRental: 0, equipmentRental: 0, cleanup: 0, contingencyPercent: 10, overheadPercent: 12 };
    const additional = (add.permits ?? 0) + (add.dumpsterRental ?? 0) + (add.equipmentRental ?? 0) + (add.cleanup ?? 0);
    const subtotal = materials + labor + additional;
    const contingency = subtotal * ((add.contingencyPercent ?? 0) / 100);
    const overhead = subtotal * ((add.overheadPercent ?? 0) / 100);
    const grand = subtotal + contingency + overhead;
    return { materials, labor, assemblies, additional, grand };
  }, [result]);

  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '92%'],
  });

  const renderInput = () => (
    <ScrollView style={s.scrollBody} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      <View style={s.heroSection}>
        <View style={s.heroIconWrap}>
          <MageAIMark size={28} color={Colors.primary} />
        </View>
        <Text style={s.heroTitle}>AI Quick Estimate</Text>
        <Text style={s.heroDesc}>
          Describe your project and MAGE Brain will generate a complete itemized estimate with materials, labor, and assemblies.
        </Text>
      </View>

      <View style={s.quickPromptsSection}>
        <Text style={s.sectionLabel}>Quick Start</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.quickPromptsRow}>
          {QUICK_PROMPTS.map((p, i) => (
            <TouchableOpacity
              key={i}
              style={[s.quickChip, description === p.prompt && s.quickChipActive]}
              onPress={() => handleQuickPrompt(p)}
              activeOpacity={0.7}
            >
              <Text style={[s.quickChipText, description === p.prompt && s.quickChipTextActive]}>{p.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <View style={s.inputSection}>
        <Text style={s.sectionLabel}>Project Description</Text>
        <TextInput
          style={s.descInput}
          value={description}
          onChangeText={setDescription}
          placeholder="e.g., 2,500 sqft kitchen remodel with mid-range finishes, new cabinets, countertops, flooring, lighting..."
          placeholderTextColor={t.textMuted}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
          testID="ai-estimate-desc"
        />
      </View>

      <View style={s.detailsRow}>
        <View style={s.detailField}>
          <Text style={s.detailLabel}>
            <Ruler size={12} color={t.textSecondary} strokeWidth={1.75} /> Sq Ft
          </Text>
          <TextInput
            style={s.detailInput}
            value={sqft}
            onChangeText={setSqft}
            placeholder="0"
            placeholderTextColor={t.textMuted}
            keyboardType="numeric"
          />
        </View>
        <View style={s.detailField}>
          <Text style={s.detailLabel}>
            <MapPin size={12} color={t.textSecondary} strokeWidth={1.75} /> Location
          </Text>
          <View style={s.locationBadge}>
            <Text style={s.locationText} numberOfLines={1}>{location || 'US Avg'}</Text>
          </View>
        </View>
      </View>

      <View style={s.inputSection}>
        <Text style={s.sectionLabel}>Project Type</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.typeRow}>
          {PROJECT_TYPES.slice(0, 8).map(pt => (
            <TouchableOpacity
              key={pt.id}
              style={[s.typeChip, projectType === pt.id && s.typeChipActive]}
              onPress={() => { setProjectType(pt.id); if (Platform.OS !== 'web') void Haptics.selectionAsync(); }}
              activeOpacity={0.7}
            >
              <Text style={[s.typeChipText, projectType === pt.id && s.typeChipTextActive]}>{pt.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <View style={s.inputSection}>
        <Text style={s.sectionLabel}>Quality Tier</Text>
        <View style={s.qualityRow}>
          {QUALITY_TIERS.map(q => (
            <TouchableOpacity
              key={q.id}
              style={[s.qualityChip, quality === q.id && s.qualityChipActive]}
              onPress={() => { setQuality(q.id); if (Platform.OS !== 'web') void Haptics.selectionAsync(); }}
              activeOpacity={0.7}
            >
              <Text style={[s.qualityChipLabel, quality === q.id && s.qualityChipLabelActive]}>{q.label}</Text>
              <Text style={[s.qualityChipDesc, quality === q.id && s.qualityChipDescActive]}>{q.desc}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {error && (
        <View style={s.errorBanner}>
          <AlertTriangle size={16} color={t.dangerLabel} strokeWidth={1.75} />
          <Text style={s.errorText}>{error}</Text>
        </View>
      )}

      <TouchableOpacity
        style={[s.generateBtn, !description.trim() && s.generateBtnDisabled]}
        onPress={handleGenerate}
        disabled={!description.trim()}
        activeOpacity={0.8}
        testID="ai-generate-btn"
      >
        <MageAIMark size={20} color="#FFF" />
        <Text style={s.generateBtnText}>Generate Estimate with AI</Text>
      </TouchableOpacity>

      {/* This used to claim the estimate was based on live market pricing.
          mageAI relays to Gemini with no browsing tool, no cost book and no
          supplier feed — the same false premise that was removed from the
          materials prompt (utils/materialFinder.ts, audit 2026-09-07). */}
      <View style={s.disclaimer}>
        <Text style={s.disclaimerText}>
          Uses 1 advanced AI credit. Every price here is the model&apos;s recall, not a quote or a market feed — price the job against your own rates before you send it.
        </Text>
      </View>

      <View style={{ height: 40 }} />
    </ScrollView>
  );

  const renderLoading = () => (
    <View style={s.loadingContainer}>
      <Animated.View style={[s.loadingIcon, { opacity: pulseAnim }]}>
        <MageAIMark size={48} color={Colors.primary} />
      </Animated.View>
      <Text style={s.loadingTitle}>Building Your Estimate</Text>
      <Text style={s.loadingDesc}>
        Usually takes 20–40 seconds. We'll fall back to a placeholder if the AI hits its timeout.
      </Text>
      <View style={s.progressBar}>
        <Animated.View style={[s.progressFill, { width: progressWidth }]} />
      </View>
      <View style={s.loadingSteps}>
        {[
          'Analyzing project requirements...',
          'Calculating material quantities...',
          'Matching labor rates for your area...',
          'Identifying cost-saving opportunities...',
          'Finalizing estimate...',
        ].map((step2, i) => (
          <View key={i} style={s.loadingStepRow}>
            <MageAIMark size={12} color={Colors.primary + '60'} />
            <Text style={s.loadingStepText}>{step2}</Text>
          </View>
        ))}
      </View>
      {/* Escape hatch — previously the loading screen had no way out, so a
          slow 30-60s AI call read as "forever loading." We don't actually
          abort the in-flight fetch (the AbortController is internal to
          mageAI), but flipping back to 'input' lets the user retype + retry
          and the orphaned response just gets dropped. */}
      <TouchableOpacity
        style={s.cancelLoadingBtn}
        onPress={() => {
          setStep('input');
          setError('Cancelled. Tap Generate again to retry.');
          if (Platform.OS !== 'web') void Haptics.selectionAsync();
        }}
        accessibilityRole="button"
        accessibilityLabel="Cancel AI generation"
      >
        <Text style={s.cancelLoadingText}>Cancel</Text>
      </TouchableOpacity>
    </View>
  );

  const renderResult = () => {
    if (!result) return null;

    return (
      <Animated.View style={[s.resultContainer, { opacity: fadeAnim }]}>
        <ScrollView showsVerticalScrollIndicator={false}>
          {/* MAGE Brain confidence — the same card as the estimate wizard, so
              the estimator's AI result reads identically wherever it appears. */}
          <BrainCard
            style={{ marginBottom: 12 }}
            confidence={result.confidenceScore}
            ground={[
              // AI-F4: only MEASURED entries may be called "learned"; a seeded
              // rate is named as one the contractor set; a calibration-only
              // prompt says history-only (utils/groundingChip). Counts come
              // from the bundle snapshotted for THIS result, not a live prop.
              groundingChipLabel(
                (resultGrounding ?? EMPTY_GROUNDING).counts,
                {
                  emptyLabel: 'Priced from market averages — close jobs to teach MAGE your real costs',
                  calibration: resultGrounding?.calibration,
                },
              ),
              result.confidenceScore === undefined ? 'No confidence score returned for this run' : null,
            ].filter(Boolean).join(' · ')}
          />

          <View style={s.totalCard}>
            <View style={s.totalRow}>
              <Text style={s.totalLabel}>Estimated Total</Text>
              <Text style={s.totalValue}>${estimatedTotals.grand.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</Text>
            </View>
            <View style={s.totalDivider} />
            <View style={s.totalBreakdownGrid}>
              <View style={s.totalBreakdownItem}>
                <Package size={14} color={Colors.primary} strokeWidth={1.75} />
                <Text style={s.totalBreakdownLabel}>Materials</Text>
                <Text style={s.totalBreakdownValue}>${estimatedTotals.materials.toLocaleString(undefined, { maximumFractionDigits: 0 })}</Text>
              </View>
              <View style={s.totalBreakdownItem}>
                <HardHat size={14} color={Colors.accent} strokeWidth={1.75} />
                <Text style={s.totalBreakdownLabel}>Labor</Text>
                <Text style={s.totalBreakdownValue}>${estimatedTotals.labor.toLocaleString(undefined, { maximumFractionDigits: 0 })}</Text>
              </View>
              <View style={s.totalBreakdownItem}>
                <Shield size={14} color={t.info} strokeWidth={1.75} />
                <Text style={s.totalBreakdownLabel}>Other</Text>
                <Text style={s.totalBreakdownValue}>${estimatedTotals.additional.toLocaleString(undefined, { maximumFractionDigits: 0 })}</Text>
              </View>
              <View style={s.totalBreakdownItem}>
                <Clock size={14} color={t.textSecondary} strokeWidth={1.75} />
                <Text style={s.totalBreakdownLabel}>Duration</Text>
                <Text style={s.totalBreakdownValue}>{result.estimatedDuration}</Text>
              </View>
            </View>
            {result.costPerSqFt > 0 && (
              <View style={s.costPerSqftRow}>
                <DollarSign size={12} color={t.textSecondary} strokeWidth={1.75} />
                <Text style={s.costPerSqftText}>${result.costPerSqFt.toFixed(0)}/sq ft</Text>
              </View>
            )}
          </View>

          {result.projectSummary ? (
            <View style={s.summaryCard}>
              <Text style={s.summaryLabel}>Scope Summary</Text>
              <Text style={s.summaryText}>{result.projectSummary}</Text>
            </View>
          ) : null}

          {renderCollapsible('materials', `Materials (${(result.materials ?? []).length})`, Package, Colors.primary, () => (
            <View style={s.itemsList}>
              {(result.materials ?? []).map((m, i) => (
                <View key={i} style={s.itemRow}>
                  <View style={s.itemLeft}>
                    <Text style={s.itemName} numberOfLines={1}>{m.name}</Text>
                    {/* The unit price, not `m.supplier`: that field defaults to
                        'Home Depot' in the schema, so this line printed a store
                        the model never checked next to a price it recalled
                        (audit 2026-09-07, money-trust). The rate is the number
                        the GC actually needs to sanity-check the row, and it is
                        a figure the estimate is genuinely built from. */}
                    <Text style={s.itemMeta}>
                      {m.quantity} {m.unit} · ${(m.unitPrice ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}/{m.unit}
                    </Text>
                  </View>
                  <Text style={s.itemPrice}>${((m.unitPrice ?? 0) * (m.quantity ?? 0)).toLocaleString(undefined, { maximumFractionDigits: 0 })}</Text>
                </View>
              ))}
            </View>
          ))}

          {renderCollapsible('labor', `Labor (${(result.labor ?? []).length})`, HardHat, Colors.accent, () => (
            <View style={s.itemsList}>
              {(result.labor ?? []).map((l, i) => (
                <View key={i} style={s.itemRow}>
                  <View style={s.itemLeft}>
                    <Text style={s.itemName}>{l.trade}</Text>
                    <Text style={s.itemMeta}>{l.hours} hrs @ ${l.hourlyRate}/hr · {l.crew}</Text>
                  </View>
                  <Text style={s.itemPrice}>${((l.hourlyRate ?? 0) * (l.hours ?? 0)).toLocaleString(undefined, { maximumFractionDigits: 0 })}</Text>
                </View>
              ))}
            </View>
          ))}

          {(result.assemblies ?? []).length > 0 && renderCollapsible('assemblies', `Assemblies (${(result.assemblies ?? []).length})`, Boxes, Colors.info, () => (
            <View style={s.itemsList}>
              {(result.assemblies ?? []).map((a, i) => (
                <View key={i} style={s.itemRow}>
                  <View style={s.itemLeft}>
                    <Text style={s.itemName}>{a.name}</Text>
                    <Text style={s.itemMeta}>{a.quantity} {a.unit}</Text>
                  </View>
                </View>
              ))}
            </View>
          ))}

          {renderCollapsible('additional', 'Additional Costs', DollarSign, t.textSecondary, () => (
            <View style={s.itemsList}>
              {(result.additionalCosts?.permits ?? 0) > 0 && (
                <View style={s.itemRow}>
                  <Text style={s.itemName}>Permits</Text>
                  <Text style={s.itemPrice}>${(result.additionalCosts?.permits ?? 0).toLocaleString()}</Text>
                </View>
              )}
              {(result.additionalCosts?.dumpsterRental ?? 0) > 0 && (
                <View style={s.itemRow}>
                  <Text style={s.itemName}>Dumpster Rental</Text>
                  <Text style={s.itemPrice}>${(result.additionalCosts?.dumpsterRental ?? 0).toLocaleString()}</Text>
                </View>
              )}
              {(result.additionalCosts?.equipmentRental ?? 0) > 0 && (
                <View style={s.itemRow}>
                  <Text style={s.itemName}>Equipment Rental</Text>
                  <Text style={s.itemPrice}>${(result.additionalCosts?.equipmentRental ?? 0).toLocaleString()}</Text>
                </View>
              )}
              {(result.additionalCosts?.cleanup ?? 0) > 0 && (
                <View style={s.itemRow}>
                  <Text style={s.itemName}>Cleanup</Text>
                  <Text style={s.itemPrice}>${(result.additionalCosts?.cleanup ?? 0).toLocaleString()}</Text>
                </View>
              )}
              <View style={s.itemRow}>
                <Text style={s.itemName}>Contingency ({result.additionalCosts?.contingencyPercent ?? 0}%)</Text>
                <Text style={s.itemPrice}>${((estimatedTotals.materials + estimatedTotals.labor + estimatedTotals.additional) * (result.additionalCosts?.contingencyPercent ?? 0) / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}</Text>
              </View>
              <View style={s.itemRow}>
                <Text style={s.itemName}>Overhead ({result.additionalCosts?.overheadPercent ?? 0}%)</Text>
                <Text style={s.itemPrice}>${((estimatedTotals.materials + estimatedTotals.labor + estimatedTotals.additional) * (result.additionalCosts?.overheadPercent ?? 0) / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}</Text>
              </View>
            </View>
          ))}

          {(result.warnings ?? []).length > 0 && (
            <View style={s.warningsCard}>
              <View style={s.warningsHeader}>
                <AlertTriangle size={14} color={t.warningLabel} strokeWidth={1.75} />
                <Text style={s.warningsTitle}>Watch Out</Text>
              </View>
              {(result.warnings ?? []).map((w, i) => (
                <Text key={i} style={s.warningItem}>• {w}</Text>
              ))}
            </View>
          )}

          {(result.savingsTips ?? []).length > 0 && (
            <View style={s.tipsCard}>
              <View style={s.tipsHeader}>
                <TrendingDown size={14} color={t.successLabel} strokeWidth={1.75} />
                <Text style={s.tipsTitle}>Savings Tips</Text>
              </View>
              {(result.savingsTips ?? []).map((t, i) => (
                <Text key={i} style={s.tipItem}>• {t}</Text>
              ))}
            </View>
          )}

          <TouchableOpacity style={s.applyBtn} onPress={handleApply} activeOpacity={0.8} testID="ai-apply-btn">
            <MageAIMark size={20} color="#FFF" />
            <Text style={s.applyBtnText}>Add All to Estimate</Text>
          </TouchableOpacity>

          <TouchableOpacity style={s.regenerateBtn} onPress={handleReset} activeOpacity={0.7}>
            <MageAIMark size={14} color={Colors.primary} />
            <Text style={s.regenerateBtnText}>Start Over</Text>
          </TouchableOpacity>

          <View style={{ height: 40 }} />
        </ScrollView>
      </Animated.View>
    );
  };

  const renderCollapsible = (
    id: string,
    title: string,
    Icon: typeof Package,
    color: string,
    content: () => React.ReactNode,
  ) => {
    const isOpen = expandedSection === id;
    return (
      <View style={s.collapsibleCard}>
        <TouchableOpacity
          style={s.collapsibleHeader}
          onPress={() => { setExpandedSection(isOpen ? null : id); if (Platform.OS !== 'web') void Haptics.selectionAsync(); }}
          activeOpacity={0.7}
        >
          <View style={s.collapsibleLeft}>
            <View style={[s.collapsibleIcon, { backgroundColor: color + '15' }]}>
              <Icon size={16} color={color} />
            </View>
            <Text style={s.collapsibleTitle}>{title}</Text>
          </View>
          {isOpen ? <ChevronUp size={18} color={t.textMuted} strokeWidth={1.75} /> : <ChevronDown size={18} color={t.textMuted} strokeWidth={1.75} />}
        </TouchableOpacity>
        {isOpen && content()}
      </View>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleClose}>
      <KeyboardAvoidingView style={s.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={s.modalHeader}>
          <View style={s.modalHandle} />
          <View style={s.modalTitleRow}>
            <View style={s.modalTitleLeft}>
              <MageAIMark size={20} color={Colors.primary} />
              <Text style={s.modalTitle}>AI Estimator</Text>
            </View>
            <TouchableOpacity onPress={handleClose} style={s.closeBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} accessibilityRole="button" accessibilityLabel="Close"><X size={20} color={t.textSecondary} strokeWidth={1.75} /></TouchableOpacity>
          </View>
        </View>

        {step === 'input' && renderInput()}
        {step === 'loading' && renderInput() /* keep input mounted underneath; overlay covers it */}
        {step === 'result' && renderResult()}
      </KeyboardAvoidingView>

      <EstimateLoadingOverlay
        visible={step === 'loading'}
        title="Generating estimate…"
        subtitle="Usually 20–40 seconds. Pulling materials, labor, and 2025 pricing."
        onCancel={() => {
          setStep('input');
          setError('Cancelled. Tap Generate again to retry.');
          if (Platform.OS !== 'web') void Haptics.selectionAsync();
        }}
      />
    </Modal>
  );
});

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: t.bg,
  },
  modalHeader: {
    paddingTop: 8,
    paddingHorizontal: 20,
    paddingBottom: 12,
    backgroundColor: t.surface,
    borderBottomWidth: 1,
    borderBottomColor: t.line,
  },
  modalHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: t.neutralSoft,
    alignSelf: 'center',
    marginBottom: 12,
  },
  modalTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modalTitleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  modalTitle: {
    fontSize: Type.title3.fontSize,
    fontWeight: '700' as const,
    color: t.text,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: Tokens.radius.xl,
    backgroundColor: t.neutralSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollBody: {
    flex: 1,
    paddingHorizontal: 20,
  },
  heroSection: {
    alignItems: 'center',
    paddingTop: 24,
    paddingBottom: 20,
    gap: 8,
  },
  heroIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: Colors.primary + '12',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  heroTitle: {
    fontSize: Type.title2.fontSize,
    fontWeight: '800' as const,
    color: t.text,
  },
  heroDesc: {
    fontSize: Type.bodyCompact.fontSize,
    color: t.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 20,
  },
  quickPromptsSection: {
    marginBottom: 16,
  },
  sectionLabel: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '700' as const,
    color: t.textSecondary,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  quickPromptsRow: {
    flexDirection: 'row',
    gap: 8,
    paddingRight: 20,
  },
  quickChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: t.surface,
    borderWidth: 1,
    borderColor: t.line,
  },
  quickChipActive: {
    backgroundColor: Colors.primary + '12',
    borderColor: Colors.primary,
  },
  quickChipText: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '500' as const,
    color: t.textSecondary,
  },
  quickChipTextActive: {
    color: Colors.primary,
    fontWeight: '600' as const,
  },
  inputSection: {
    marginBottom: 16,
  },
  descInput: {
    minHeight: 100,
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.lg,
    padding: 14,
    fontSize: Type.subhead.fontSize,
    color: t.text,
    lineHeight: 22,
    borderWidth: 1,
    borderColor: t.line,
  },
  detailsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  detailField: {
    flex: 1,
    gap: 6,
  },
  detailLabel: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '600' as const,
    color: t.textSecondary,
  },
  detailInput: {
    height: 44,
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.card,
    paddingHorizontal: 14,
    fontSize: Type.callout.fontSize,
    fontWeight: '600' as const,
    color: t.text,
    borderWidth: 1,
    borderColor: t.line,
  },
  locationBadge: {
    height: 44,
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.card,
    paddingHorizontal: 14,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: t.line,
  },
  locationText: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '500' as const,
    color: t.text,
  },
  typeRow: {
    flexDirection: 'row',
    gap: 8,
    paddingRight: 20,
  },
  typeChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: t.surface,
    borderWidth: 1,
    borderColor: t.line,
  },
  typeChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  typeChipText: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '500' as const,
    color: t.textSecondary,
  },
  typeChipTextActive: {
    color: Colors.textOnPrimary,
    fontWeight: '600' as const,
  },
  qualityRow: {
    flexDirection: 'row',
    gap: 8,
  },
  qualityChip: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: Tokens.radius.card,
    backgroundColor: t.surface,
    borderWidth: 1,
    borderColor: t.line,
    alignItems: 'center',
    gap: 2,
  },
  qualityChipActive: {
    backgroundColor: Colors.primary + '12',
    borderColor: Colors.primary,
  },
  qualityChipLabel: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '700' as const,
    color: t.text,
  },
  qualityChipLabelActive: {
    color: Colors.primary,
  },
  qualityChipDesc: {
    fontSize: 10,
    color: t.textMuted,
    textAlign: 'center' as const,
  },
  qualityChipDescActive: {
    color: Colors.primary,
  },
  // The four tinted grounds below were `Colors.errorLight` / `warningLight` /
  // `successLight` — baked LIGHT hex, frozen once at import while this sheet
  // was a module-scope StyleSheet.create. Turning the sheet into a `(t) =>`
  // factory (2026-09-07) made the ink on top re-resolve per theme, so in dark
  // mode `t.dangerLabel` #FF5A51 landed on #FFF0EF (2.78:1), `t.warningLabel`
  // #FF9500 on #FFF3E0 (~2.0:1) and `t.successLabel` #4ED37A on #E8FAF0
  // (~1.6:1) — a contrast regression the theming fix itself created. The
  // *Soft tokens are the grounds those inks are measured against
  // (constants/colors.ts:410-453).
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: t.dangerSoft,
    borderRadius: Tokens.radius.card,
    padding: 14,
    marginBottom: 12,
  },
  errorText: {
    flex: 1,
    fontSize: Type.footnote.fontSize,
    color: t.dangerLabel,
    fontWeight: '500' as const,
  },
  generateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: Colors.primary,
    borderRadius: Tokens.radius.panel,
    paddingVertical: 18,
    marginTop: 8,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 4,
  },
  generateBtnDisabled: {
    opacity: 0.5,
  },
  generateBtnText: {
    fontSize: Type.body.fontSize,
    fontWeight: '700' as const,
    color: '#FFF',
  },
  disclaimer: {
    paddingTop: 12,
    paddingHorizontal: 4,
  },
  disclaimerText: {
    fontSize: Type.caption2.fontSize,
    color: t.textMuted,
    textAlign: 'center',
    lineHeight: 16,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    gap: 16,
  },
  loadingIcon: {
    width: 80,
    height: 80,
    borderRadius: Tokens.radius["2xl"],
    backgroundColor: Colors.primary + '12',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  loadingTitle: {
    fontSize: Type.title3.fontSize,
    fontWeight: '700' as const,
    color: t.text,
  },
  loadingDesc: {
    fontSize: Type.bodyCompact.fontSize,
    color: t.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  progressBar: {
    width: '100%',
    height: 4,
    backgroundColor: t.neutralSoft,
    borderRadius: 2,
    overflow: 'hidden',
    marginTop: 8,
  },
  progressFill: {
    height: '100%',
    backgroundColor: Colors.primary,
    borderRadius: 2,
  },
  loadingSteps: {
    gap: 8,
    marginTop: 16,
    width: '100%',
  },
  loadingStepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  loadingStepText: {
    fontSize: Type.footnote.fontSize,
    color: t.textMuted,
  },
  cancelLoadingBtn: {
    marginTop: 24,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.line,
    backgroundColor: t.surfaceAlt,
  },
  cancelLoadingText: {
    fontSize: Type.footnote.fontSize,
    color: t.text,
    fontWeight: '600',
  },
  resultContainer: {
    flex: 1,
    paddingHorizontal: 20,
  },
  resultHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 16,
    paddingBottom: 8,
  },
  resultBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Tokens.radius.sm,
    backgroundColor: Colors.primary + '12',
  },
  resultBadgeText: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '600' as const,
    color: Colors.primary,
  },
  confidenceBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Tokens.radius.sm,
  },
  confidenceText: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '700' as const,
  },
  resultSummary: {
    fontSize: Type.bodyCompact.fontSize,
    color: t.textSecondary,
    lineHeight: 20,
    marginBottom: 16,
  },
  summaryCard: {
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.card,
    padding: 14,
    marginTop: 12,
    marginBottom: 8,
    borderWidth: 0.5,
    borderColor: t.line,
  },
  summaryLabel: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '700' as const,
    color: t.textMuted,
    letterSpacing: 0.5,
    textTransform: 'uppercase' as const,
    marginBottom: 6,
  },
  summaryText: {
    fontSize: Type.footnote.fontSize,
    color: t.textSecondary,
    lineHeight: 19,
  },
  totalCard: {
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.panel,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.primary + '20',
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  totalLabel: {
    fontSize: Type.subhead.fontSize,
    fontWeight: '600' as const,
    color: t.textSecondary,
  },
  totalValue: {
    fontSize: Type.title1.fontSize,
    fontWeight: '800' as const,
    color: Colors.primary,
  },
  totalDivider: {
    height: 1,
    backgroundColor: t.line,
    marginVertical: 12,
  },
  totalBreakdownGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  totalBreakdownItem: {
    flex: 1,
    minWidth: '40%' as unknown as number,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: t.bg,
    borderRadius: Tokens.radius.md,
    padding: 10,
  },
  totalBreakdownLabel: {
    fontSize: Type.caption2.fontSize,
    color: t.textMuted,
  },
  totalBreakdownValue: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '700' as const,
    color: t.text,
    marginLeft: 'auto' as const,
  },
  costPerSqftRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    marginTop: 12,
  },
  costPerSqftText: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '600' as const,
    color: t.textSecondary,
  },
  collapsibleCard: {
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.lg,
    marginBottom: 10,
    overflow: 'hidden',
  },
  collapsibleHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 14,
  },
  collapsibleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  collapsibleIcon: {
    width: 32,
    height: 32,
    borderRadius: Tokens.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  collapsibleTitle: {
    fontSize: Type.subhead.fontSize,
    fontWeight: '600' as const,
    color: t.text,
  },
  itemsList: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    gap: 6,
  },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: t.bg,
    borderRadius: Tokens.radius.md,
  },
  itemLeft: {
    flex: 1,
    marginRight: 10,
  },
  itemName: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '600' as const,
    color: t.text,
  },
  itemMeta: {
    fontSize: Type.caption2.fontSize,
    color: t.textMuted,
    marginTop: 2,
  },
  itemPrice: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '700' as const,
    color: Colors.primary,
  },
  warningsCard: {
    backgroundColor: t.warningSoft,
    borderRadius: Tokens.radius.lg,
    padding: 14,
    marginBottom: 10,
    gap: 6,
  },
  warningsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  warningsTitle: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '700' as const,
    color: t.warningLabel,
  },
  warningItem: {
    // Was #7A5400 — a dark ink chosen for the pale ground above. On the themed
    // warningSoft it would be dark-on-dark in dark mode.
    fontSize: Type.footnote.fontSize,
    color: t.text,
    lineHeight: 18,
  },
  tipsCard: {
    backgroundColor: t.successSoft,
    borderRadius: Tokens.radius.lg,
    padding: 14,
    marginBottom: 16,
    gap: 6,
  },
  tipsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  tipsTitle: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '700' as const,
    color: t.successLabel,
  },
  tipItem: {
    // Was #1B5E20, same story as warningItem.
    fontSize: Type.footnote.fontSize,
    color: t.text,
    lineHeight: 18,
  },
  applyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: Colors.primary,
    borderRadius: Tokens.radius.panel,
    paddingVertical: 18,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 4,
  },
  applyBtnText: {
    fontSize: Type.body.fontSize,
    fontWeight: '700' as const,
    color: '#FFF',
  },
  regenerateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
    marginTop: 4,
  },
  regenerateBtnText: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '600' as const,
    color: Colors.primary,
  },
  groundingChip: {
    marginHorizontal: 16,
    marginBottom: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    // `Colors.successLight ?? '#E8FAF0'` — the `??` was dead (the constant is
    // non-nullable) and the value was a baked light hex under themed ink.
    backgroundColor: t.successSoft,
    borderRadius: 8,
    alignItems: 'center',
  },
  groundingChipText: {
    fontSize: 12,
    color: t.successLabel,
    fontWeight: '500' as const,
    textAlign: 'center',
  },
});
