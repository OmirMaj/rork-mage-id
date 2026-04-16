import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, TextInput,
  ScrollView, ActivityIndicator, Animated, Platform, Alert, KeyboardAvoidingView,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import {
  Sparkles, X, ChevronRight, Wand2, AlertTriangle, Lightbulb,
  TrendingDown, Clock, MapPin, Ruler, Package, HardHat, Boxes,
  CheckCircle, DollarSign, Shield, ChevronDown, ChevronUp, Zap,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { PROJECT_TYPES, type ProjectType, type QualityTier } from '@/types';
import { generateQuickEstimate, type AIQuickEstimateResult } from '@/utils/aiService';
import { checkAILimit, recordAIUsage } from '@/utils/aiRateLimiter';
import type { MaterialItem } from '@/constants/materials';
import { LABOR_RATES, type LaborRate } from '@/constants/laborRates';
import { ASSEMBLIES, type AssemblyItem } from '@/constants/assemblies';

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
}: Props) {
  const [step, setStep] = useState<'input' | 'loading' | 'result'>('input');
  const [description, setDescription] = useState('');
  const [projectType, setProjectType] = useState<ProjectType>('renovation');
  const [sqft, setSqft] = useState('');
  const [quality, setQuality] = useState<QualityTier>('standard');
  const [result, setResult] = useState<AIQuickEstimateResult | null>(null);
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
      Alert.alert('Describe Your Project', 'Tell us what you\'re building so AI can generate an accurate estimate.');
      return;
    }

    const limit = await checkAILimit('free', 'smart');
    if (!limit.allowed) {
      Alert.alert('AI Limit Reached', limit.message ?? 'Rate limit reached.');
      return;
    }

    setStep('loading');
    setError(null);
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      const data = await generateQuickEstimate(
        description,
        projectType,
        parseInt(sqft, 10) || 0,
        quality,
        location,
      );
      await recordAIUsage('smart');
      setResult(data);
      setStep('result');
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      console.log('[AI Quick Estimate] Success:', data.materials.length, 'materials');
    } catch (err) {
      console.error('[AI Quick Estimate] Error:', err);
      setError('Failed to generate estimate. Please try again.');
      setStep('input');
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }, [description, projectType, sqft, quality, location]);

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
        supplier: aiMat.supplier || 'AI Estimated',
        pricingModel: 'market',
        sourceLabel: matched ? 'Matched' : 'AI Generated',
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

    Alert.alert(
      'Estimate Generated',
      `Added ${materialItems.length} materials, ${laborItems.length} labor items, and ${assemblyItems.length} assemblies to your estimate.`,
    );
  }, [result, matchMaterial, globalMarkup, calculateAssemblyCost, onApplyEstimate, handleClose]);

  const estimatedTotals = useMemo(() => {
    if (!result) return { materials: 0, labor: 0, assemblies: 0, additional: 0, grand: 0 };
    const materials = result.materials.reduce((s, m) => s + m.unitPrice * m.quantity, 0);
    const labor = result.labor.reduce((s, l) => s + l.hourlyRate * l.hours, 0);
    const assemblies = result.assemblies.length;
    const add = result.additionalCosts;
    const additional = add.permits + add.dumpsterRental + add.equipmentRental + add.cleanup;
    const subtotal = materials + labor + additional;
    const contingency = subtotal * (add.contingencyPercent / 100);
    const overhead = subtotal * (add.overheadPercent / 100);
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
          <Wand2 size={28} color={Colors.primary} />
        </View>
        <Text style={s.heroTitle}>AI Quick Estimate</Text>
        <Text style={s.heroDesc}>
          Describe your project and MAGE AI will generate a complete itemized estimate with materials, labor, and assemblies.
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
          placeholderTextColor={Colors.textMuted}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
          testID="ai-estimate-desc"
        />
      </View>

      <View style={s.detailsRow}>
        <View style={s.detailField}>
          <Text style={s.detailLabel}>
            <Ruler size={12} color={Colors.textSecondary} /> Sq Ft
          </Text>
          <TextInput
            style={s.detailInput}
            value={sqft}
            onChangeText={setSqft}
            placeholder="0"
            placeholderTextColor={Colors.textMuted}
            keyboardType="numeric"
          />
        </View>
        <View style={s.detailField}>
          <Text style={s.detailLabel}>
            <MapPin size={12} color={Colors.textSecondary} /> Location
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
          <AlertTriangle size={16} color={Colors.error} />
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
        <Sparkles size={20} color="#FFF" />
        <Text style={s.generateBtnText}>Generate Estimate with AI</Text>
      </TouchableOpacity>

      <View style={s.disclaimer}>
        <Text style={s.disclaimerText}>
          Uses 1 advanced AI credit. Estimate is based on current market data and should be reviewed before sending to clients.
        </Text>
      </View>

      <View style={{ height: 40 }} />
    </ScrollView>
  );

  const renderLoading = () => (
    <View style={s.loadingContainer}>
      <Animated.View style={[s.loadingIcon, { opacity: pulseAnim }]}>
        <Wand2 size={48} color={Colors.primary} />
      </Animated.View>
      <Text style={s.loadingTitle}>Building Your Estimate</Text>
      <Text style={s.loadingDesc}>
        Analyzing project scope, calculating materials, matching labor rates, and optimizing costs...
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
            <Sparkles size={12} color={Colors.primary + '60'} />
            <Text style={s.loadingStepText}>{step2}</Text>
          </View>
        ))}
      </View>
    </View>
  );

  const renderResult = () => {
    if (!result) return null;

    const confidenceColor = result.confidenceScore >= 75 ? Colors.success :
      result.confidenceScore >= 50 ? Colors.warning : Colors.error;

    return (
      <Animated.View style={[s.resultContainer, { opacity: fadeAnim }]}>
        <ScrollView showsVerticalScrollIndicator={false}>
          <View style={s.resultHeader}>
            <View style={s.resultBadge}>
              <Sparkles size={14} color={Colors.primary} />
              <Text style={s.resultBadgeText}>AI Generated</Text>
            </View>
            <View style={[s.confidenceBadge, { backgroundColor: confidenceColor + '15' }]}>
              <Text style={[s.confidenceText, { color: confidenceColor }]}>{result.confidenceScore}% confidence</Text>
            </View>
          </View>

          <Text style={s.resultSummary}>{result.projectSummary}</Text>

          <View style={s.totalCard}>
            <View style={s.totalRow}>
              <Text style={s.totalLabel}>Estimated Total</Text>
              <Text style={s.totalValue}>${estimatedTotals.grand.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</Text>
            </View>
            <View style={s.totalDivider} />
            <View style={s.totalBreakdownGrid}>
              <View style={s.totalBreakdownItem}>
                <Package size={14} color={Colors.primary} />
                <Text style={s.totalBreakdownLabel}>Materials</Text>
                <Text style={s.totalBreakdownValue}>${estimatedTotals.materials.toLocaleString(undefined, { maximumFractionDigits: 0 })}</Text>
              </View>
              <View style={s.totalBreakdownItem}>
                <HardHat size={14} color={Colors.accent} />
                <Text style={s.totalBreakdownLabel}>Labor</Text>
                <Text style={s.totalBreakdownValue}>${estimatedTotals.labor.toLocaleString(undefined, { maximumFractionDigits: 0 })}</Text>
              </View>
              <View style={s.totalBreakdownItem}>
                <Shield size={14} color={Colors.info} />
                <Text style={s.totalBreakdownLabel}>Other</Text>
                <Text style={s.totalBreakdownValue}>${estimatedTotals.additional.toLocaleString(undefined, { maximumFractionDigits: 0 })}</Text>
              </View>
              <View style={s.totalBreakdownItem}>
                <Clock size={14} color={Colors.textSecondary} />
                <Text style={s.totalBreakdownLabel}>Duration</Text>
                <Text style={s.totalBreakdownValue}>{result.estimatedDuration}</Text>
              </View>
            </View>
            {result.costPerSqFt > 0 && (
              <View style={s.costPerSqftRow}>
                <DollarSign size={12} color={Colors.textSecondary} />
                <Text style={s.costPerSqftText}>${result.costPerSqFt.toFixed(0)}/sq ft</Text>
              </View>
            )}
          </View>

          {renderCollapsible('materials', `Materials (${result.materials.length})`, Package, Colors.primary, () => (
            <View style={s.itemsList}>
              {result.materials.map((m, i) => (
                <View key={i} style={s.itemRow}>
                  <View style={s.itemLeft}>
                    <Text style={s.itemName} numberOfLines={1}>{m.name}</Text>
                    <Text style={s.itemMeta}>{m.quantity} {m.unit} · {m.supplier}</Text>
                  </View>
                  <Text style={s.itemPrice}>${(m.unitPrice * m.quantity).toLocaleString(undefined, { maximumFractionDigits: 0 })}</Text>
                </View>
              ))}
            </View>
          ))}

          {renderCollapsible('labor', `Labor (${result.labor.length})`, HardHat, Colors.accent, () => (
            <View style={s.itemsList}>
              {result.labor.map((l, i) => (
                <View key={i} style={s.itemRow}>
                  <View style={s.itemLeft}>
                    <Text style={s.itemName}>{l.trade}</Text>
                    <Text style={s.itemMeta}>{l.hours} hrs @ ${l.hourlyRate}/hr · {l.crew}</Text>
                  </View>
                  <Text style={s.itemPrice}>${(l.hourlyRate * l.hours).toLocaleString(undefined, { maximumFractionDigits: 0 })}</Text>
                </View>
              ))}
            </View>
          ))}

          {result.assemblies.length > 0 && renderCollapsible('assemblies', `Assemblies (${result.assemblies.length})`, Boxes, Colors.info, () => (
            <View style={s.itemsList}>
              {result.assemblies.map((a, i) => (
                <View key={i} style={s.itemRow}>
                  <View style={s.itemLeft}>
                    <Text style={s.itemName}>{a.name}</Text>
                    <Text style={s.itemMeta}>{a.quantity} {a.unit}</Text>
                  </View>
                </View>
              ))}
            </View>
          ))}

          {renderCollapsible('additional', 'Additional Costs', DollarSign, Colors.textSecondary, () => (
            <View style={s.itemsList}>
              {result.additionalCosts.permits > 0 && (
                <View style={s.itemRow}>
                  <Text style={s.itemName}>Permits</Text>
                  <Text style={s.itemPrice}>${result.additionalCosts.permits.toLocaleString()}</Text>
                </View>
              )}
              {result.additionalCosts.dumpsterRental > 0 && (
                <View style={s.itemRow}>
                  <Text style={s.itemName}>Dumpster Rental</Text>
                  <Text style={s.itemPrice}>${result.additionalCosts.dumpsterRental.toLocaleString()}</Text>
                </View>
              )}
              {result.additionalCosts.equipmentRental > 0 && (
                <View style={s.itemRow}>
                  <Text style={s.itemName}>Equipment Rental</Text>
                  <Text style={s.itemPrice}>${result.additionalCosts.equipmentRental.toLocaleString()}</Text>
                </View>
              )}
              {result.additionalCosts.cleanup > 0 && (
                <View style={s.itemRow}>
                  <Text style={s.itemName}>Cleanup</Text>
                  <Text style={s.itemPrice}>${result.additionalCosts.cleanup.toLocaleString()}</Text>
                </View>
              )}
              <View style={s.itemRow}>
                <Text style={s.itemName}>Contingency ({result.additionalCosts.contingencyPercent}%)</Text>
                <Text style={s.itemPrice}>${((estimatedTotals.materials + estimatedTotals.labor + estimatedTotals.additional) * result.additionalCosts.contingencyPercent / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}</Text>
              </View>
              <View style={s.itemRow}>
                <Text style={s.itemName}>Overhead ({result.additionalCosts.overheadPercent}%)</Text>
                <Text style={s.itemPrice}>${((estimatedTotals.materials + estimatedTotals.labor + estimatedTotals.additional) * result.additionalCosts.overheadPercent / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}</Text>
              </View>
            </View>
          ))}

          {result.warnings.length > 0 && (
            <View style={s.warningsCard}>
              <View style={s.warningsHeader}>
                <AlertTriangle size={14} color={Colors.warning} />
                <Text style={s.warningsTitle}>Watch Out</Text>
              </View>
              {result.warnings.map((w, i) => (
                <Text key={i} style={s.warningItem}>• {w}</Text>
              ))}
            </View>
          )}

          {result.savingsTips.length > 0 && (
            <View style={s.tipsCard}>
              <View style={s.tipsHeader}>
                <TrendingDown size={14} color={Colors.success} />
                <Text style={s.tipsTitle}>Savings Tips</Text>
              </View>
              {result.savingsTips.map((t, i) => (
                <Text key={i} style={s.tipItem}>• {t}</Text>
              ))}
            </View>
          )}

          <TouchableOpacity style={s.applyBtn} onPress={handleApply} activeOpacity={0.8} testID="ai-apply-btn">
            <Zap size={20} color="#FFF" />
            <Text style={s.applyBtnText}>Add All to Estimate</Text>
          </TouchableOpacity>

          <TouchableOpacity style={s.regenerateBtn} onPress={handleReset} activeOpacity={0.7}>
            <Sparkles size={14} color={Colors.primary} />
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
          {isOpen ? <ChevronUp size={18} color={Colors.textMuted} /> : <ChevronDown size={18} color={Colors.textMuted} />}
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
              <Sparkles size={20} color={Colors.primary} />
              <Text style={s.modalTitle}>AI Estimator</Text>
            </View>
            <TouchableOpacity onPress={handleClose} style={s.closeBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <X size={20} color={Colors.textSecondary} />
            </TouchableOpacity>
          </View>
        </View>

        {step === 'input' && renderInput()}
        {step === 'loading' && renderLoading()}
        {step === 'result' && renderResult()}
      </KeyboardAvoidingView>
    </Modal>
  );
});

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  modalHeader: {
    paddingTop: 8,
    paddingHorizontal: 20,
    paddingBottom: 12,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  modalHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.fillTertiary,
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
    fontSize: 20,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.fillSecondary,
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
    fontSize: 22,
    fontWeight: '800' as const,
    color: Colors.text,
  },
  heroDesc: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 20,
  },
  quickPromptsSection: {
    marginBottom: 16,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: Colors.textSecondary,
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
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  quickChipActive: {
    backgroundColor: Colors.primary + '12',
    borderColor: Colors.primary,
  },
  quickChipText: {
    fontSize: 13,
    fontWeight: '500' as const,
    color: Colors.textSecondary,
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
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    fontSize: 15,
    color: Colors.text,
    lineHeight: 22,
    borderWidth: 1,
    borderColor: Colors.border,
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
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },
  detailInput: {
    height: 44,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    paddingHorizontal: 14,
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  locationBadge: {
    height: 44,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    paddingHorizontal: 14,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  locationText: {
    fontSize: 14,
    fontWeight: '500' as const,
    color: Colors.text,
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
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  typeChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  typeChipText: {
    fontSize: 13,
    fontWeight: '500' as const,
    color: Colors.textSecondary,
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
    borderRadius: 12,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    gap: 2,
  },
  qualityChipActive: {
    backgroundColor: Colors.primary + '12',
    borderColor: Colors.primary,
  },
  qualityChipLabel: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  qualityChipLabelActive: {
    color: Colors.primary,
  },
  qualityChipDesc: {
    fontSize: 10,
    color: Colors.textMuted,
    textAlign: 'center' as const,
  },
  qualityChipDescActive: {
    color: Colors.primary,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.errorLight,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    color: Colors.error,
    fontWeight: '500' as const,
  },
  generateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: Colors.primary,
    borderRadius: 16,
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
    fontSize: 17,
    fontWeight: '700' as const,
    color: '#FFF',
  },
  disclaimer: {
    paddingTop: 12,
    paddingHorizontal: 4,
  },
  disclaimerText: {
    fontSize: 11,
    color: Colors.textMuted,
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
    borderRadius: 24,
    backgroundColor: Colors.primary + '12',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  loadingTitle: {
    fontSize: 20,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  loadingDesc: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  progressBar: {
    width: '100%',
    height: 4,
    backgroundColor: Colors.fillTertiary,
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
    fontSize: 13,
    color: Colors.textMuted,
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
    borderRadius: 8,
    backgroundColor: Colors.primary + '12',
  },
  resultBadgeText: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.primary,
  },
  confidenceBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  confidenceText: {
    fontSize: 12,
    fontWeight: '700' as const,
  },
  resultSummary: {
    fontSize: 14,
    color: Colors.textSecondary,
    lineHeight: 20,
    marginBottom: 16,
  },
  totalCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
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
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },
  totalValue: {
    fontSize: 28,
    fontWeight: '800' as const,
    color: Colors.primary,
  },
  totalDivider: {
    height: 1,
    backgroundColor: Colors.borderLight,
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
    backgroundColor: Colors.background,
    borderRadius: 10,
    padding: 10,
  },
  totalBreakdownLabel: {
    fontSize: 11,
    color: Colors.textMuted,
  },
  totalBreakdownValue: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: Colors.text,
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
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },
  collapsibleCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
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
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  collapsibleTitle: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.text,
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
    backgroundColor: Colors.background,
    borderRadius: 10,
  },
  itemLeft: {
    flex: 1,
    marginRight: 10,
  },
  itemName: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  itemMeta: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 2,
  },
  itemPrice: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: Colors.primary,
  },
  warningsCard: {
    backgroundColor: Colors.warningLight,
    borderRadius: 14,
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
    fontSize: 14,
    fontWeight: '700' as const,
    color: Colors.warning,
  },
  warningItem: {
    fontSize: 13,
    color: '#7A5400',
    lineHeight: 18,
  },
  tipsCard: {
    backgroundColor: Colors.successLight,
    borderRadius: 14,
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
    fontSize: 14,
    fontWeight: '700' as const,
    color: Colors.success,
  },
  tipItem: {
    fontSize: 13,
    color: '#1B5E20',
    lineHeight: 18,
  },
  applyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: Colors.primary,
    borderRadius: 16,
    paddingVertical: 18,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 4,
  },
  applyBtnText: {
    fontSize: 17,
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
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.primary,
  },
});
