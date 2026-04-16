import React, { useState, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, Modal, Platform,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { X, ChevronRight, Building2, Home, Hammer, Trees, Calculator, TrendingUp, TrendingDown, Minus as MinusIcon } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { SQUARE_FOOT_MODELS, QUALITY_TIERS, SF_CATEGORIES, type SquareFootModel, type QualityTier } from '@/constants/squareFootCosts';

interface SquareFootEstimatorProps {
  visible: boolean;
  onClose: () => void;
  locationFactor?: number;
}

const CATEGORY_ICONS: Record<string, typeof Home> = {
  residential: Home,
  renovation: Hammer,
  commercial: Building2,
  exterior: Trees,
};

function formatCurrency(value: number): string {
  if (value >= 1000000) return `$${(value / 1000000).toFixed(2)}M`;
  if (value >= 1000) return `$${(value / 1000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

const SquareFootEstimator = React.memo(function SquareFootEstimator({ visible, onClose, locationFactor = 1 }: SquareFootEstimatorProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [selectedModel, setSelectedModel] = useState<SquareFootModel | null>(null);
  const [selectedQuality, setSelectedQuality] = useState<QualityTier>('standard');
  const [sqftInput, setSqftInput] = useState('');

  const resetState = useCallback(() => {
    setStep(1);
    setSelectedCategory('all');
    setSelectedModel(null);
    setSelectedQuality('standard');
    setSqftInput('');
  }, []);

  const handleClose = useCallback(() => {
    onClose();
    setTimeout(resetState, 300);
  }, [onClose, resetState]);

  const filteredModels = useMemo(() => {
    if (selectedCategory === 'all') return SQUARE_FOOT_MODELS;
    return SQUARE_FOOT_MODELS.filter(m => m.category === selectedCategory);
  }, [selectedCategory]);

  const handleSelectModel = useCallback((model: SquareFootModel) => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedModel(model);
    setSqftInput(String(Math.round((model.typicalSizeRange.min + model.typicalSizeRange.max) / 2)));
    setStep(2);
  }, []);

  const handleSelectQuality = useCallback((tier: QualityTier) => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    setSelectedQuality(tier);
  }, []);

  const sqft = useMemo(() => parseInt(sqftInput, 10) || 0, [sqftInput]);

  const costResult = useMemo(() => {
    if (!selectedModel || sqft <= 0) return null;
    const tierData = selectedModel.costPerSF[selectedQuality];
    return {
      low: Math.round(tierData.low * sqft * locationFactor),
      mid: Math.round(tierData.mid * sqft * locationFactor),
      high: Math.round(tierData.high * sqft * locationFactor),
      perSfLow: Number((tierData.low * locationFactor).toFixed(0)),
      perSfMid: Number((tierData.mid * locationFactor).toFixed(0)),
      perSfHigh: Number((tierData.high * locationFactor).toFixed(0)),
    };
  }, [selectedModel, sqft, selectedQuality, locationFactor]);

  const renderStep1 = () => (
    <>
      <Text style={s.stepTitle}>Select Building Type</Text>
      <View style={s.categoryRow}>
        {SF_CATEGORIES.map(cat => {
          const isActive = selectedCategory === cat.id;
          return (
            <TouchableOpacity
              key={cat.id}
              style={[s.catChip, isActive && s.catChipActive]}
              onPress={() => setSelectedCategory(cat.id)}
              activeOpacity={0.7}
            >
              <Text style={[s.catChipText, isActive && s.catChipTextActive]}>{cat.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <ScrollView style={s.modelList} showsVerticalScrollIndicator={false}>
        {filteredModels.map(model => {
          const CatIcon = CATEGORY_ICONS[model.category] ?? Building2;
          const midRange = model.costPerSF.standard;
          return (
            <TouchableOpacity
              key={model.id}
              style={s.modelCard}
              onPress={() => handleSelectModel(model)}
              activeOpacity={0.7}
            >
              <View style={s.modelCardTop}>
                <View style={[s.modelIconWrap, { backgroundColor: Colors.primary + '12' }]}>
                  <CatIcon size={18} color={Colors.primary} />
                </View>
                <View style={s.modelCardInfo}>
                  <Text style={s.modelName}>{model.buildingType}</Text>
                  <Text style={s.modelDesc} numberOfLines={1}>{model.description}</Text>
                </View>
                <ChevronRight size={16} color={Colors.textMuted} />
              </View>
              <View style={s.modelCardBottom}>
                <Text style={s.modelRange}>${midRange.low}-${midRange.high}/SF</Text>
                <Text style={s.modelSize}>{model.typicalSizeRange.min.toLocaleString()}-{model.typicalSizeRange.max.toLocaleString()} SF</Text>
              </View>
            </TouchableOpacity>
          );
        })}
        <View style={{ height: 20 }} />
      </ScrollView>
    </>
  );

  const renderStep2 = () => {
    if (!selectedModel) return null;
    return (
      <>
        <TouchableOpacity style={s.backBtn} onPress={() => setStep(1)}>
          <Text style={s.backBtnText}>← Change type</Text>
        </TouchableOpacity>
        <Text style={s.stepTitle}>{selectedModel.buildingType}</Text>
        <Text style={s.stepSubtitle}>Select quality level & enter size</Text>

        <View style={s.qualityGrid}>
          {QUALITY_TIERS.map(tier => {
            const isActive = selectedQuality === tier.id;
            const tierCost = selectedModel.costPerSF[tier.id];
            return (
              <TouchableOpacity
                key={tier.id}
                style={[s.qualityCard, isActive && s.qualityCardActive]}
                onPress={() => handleSelectQuality(tier.id)}
                activeOpacity={0.7}
              >
                <Text style={[s.qualityLabel, isActive && s.qualityLabelActive]}>{tier.label}</Text>
                <Text style={[s.qualityRange, isActive && s.qualityRangeActive]}>
                  ${tierCost.low}-${tierCost.high}
                </Text>
                <Text style={[s.qualityUnit, isActive && s.qualityUnitActive]}>per SF</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={s.fieldLabel}>Square Footage</Text>
        <View style={s.sqftRow}>
          <TouchableOpacity style={s.sqftBtn} onPress={() => setSqftInput(String(Math.max(0, sqft - 100)))}>
            <MinusIcon size={18} color={Colors.primary} />
          </TouchableOpacity>
          <TextInput
            style={s.sqftInput}
            value={sqftInput}
            onChangeText={setSqftInput}
            keyboardType="number-pad"
            textAlign="center"
            placeholder="Enter SF"
            placeholderTextColor={Colors.textMuted}
          />
          <TouchableOpacity style={s.sqftBtn} onPress={() => setSqftInput(String(sqft + 100))}>
            <Text style={s.sqftBtnText}>+</Text>
          </TouchableOpacity>
        </View>

        <View style={s.presetRow}>
          {[selectedModel.typicalSizeRange.min, Math.round((selectedModel.typicalSizeRange.min + selectedModel.typicalSizeRange.max) / 2), selectedModel.typicalSizeRange.max].map(val => (
            <TouchableOpacity key={val} style={s.presetChip} onPress={() => setSqftInput(String(val))}>
              <Text style={s.presetText}>{val.toLocaleString()} SF</Text>
            </TouchableOpacity>
          ))}
        </View>

        {costResult && (
          <View style={s.resultCard}>
            <View style={s.resultHeader}>
              <Calculator size={16} color={Colors.primary} />
              <Text style={s.resultTitle}>Estimated Cost Range</Text>
            </View>
            {locationFactor !== 1 && (
              <View style={s.locationBadge}>
                <Text style={s.locationText}>Location factor: {locationFactor.toFixed(2)}x</Text>
              </View>
            )}
            <View style={s.resultRow}>
              <View style={s.resultCol}>
                <TrendingDown size={14} color={Colors.success} />
                <Text style={s.resultLabel}>Low</Text>
                <Text style={s.resultValueLow}>{formatCurrency(costResult.low)}</Text>
                <Text style={s.resultPerSf}>${costResult.perSfLow}/SF</Text>
              </View>
              <View style={[s.resultCol, s.resultColMid]}>
                <Calculator size={14} color={Colors.primary} />
                <Text style={s.resultLabel}>Mid</Text>
                <Text style={s.resultValueMid}>{formatCurrency(costResult.mid)}</Text>
                <Text style={s.resultPerSf}>${costResult.perSfMid}/SF</Text>
              </View>
              <View style={s.resultCol}>
                <TrendingUp size={14} color={Colors.error} />
                <Text style={s.resultLabel}>High</Text>
                <Text style={s.resultValueHigh}>{formatCurrency(costResult.high)}</Text>
                <Text style={s.resultPerSf}>${costResult.perSfHigh}/SF</Text>
              </View>
            </View>
            {selectedModel.notes ? (
              <Text style={s.resultNotes}>{selectedModel.notes}</Text>
            ) : null}
          </View>
        )}
      </>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : undefined} onRequestClose={handleClose}>
      <View style={s.container}>
        <View style={s.header}>
          <View>
            <Text style={s.headerTitle}>Quick Estimate</Text>
            <Text style={s.headerSub}>Square foot cost calculator</Text>
          </View>
          <TouchableOpacity onPress={handleClose} style={s.closeBtn}>
            <X size={20} color={Colors.text} />
          </TouchableOpacity>
        </View>
        <View style={s.body}>
          {step === 1 && renderStep1()}
          {step === 2 && renderStep2()}
        </View>
      </View>
    </Modal>
  );
});

export default SquareFootEstimator;

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12,
    backgroundColor: Colors.surface, borderBottomWidth: 0.5, borderBottomColor: Colors.borderLight,
  },
  headerTitle: { fontSize: 22, fontWeight: '700' as const, color: Colors.text, letterSpacing: -0.3 },
  headerSub: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
  closeBtn: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: Colors.fillTertiary,
    alignItems: 'center', justifyContent: 'center',
  },
  body: { flex: 1, paddingHorizontal: 16, paddingTop: 12 },
  stepTitle: { fontSize: 18, fontWeight: '700' as const, color: Colors.text, marginBottom: 4 },
  stepSubtitle: { fontSize: 13, color: Colors.textSecondary, marginBottom: 12 },
  categoryRow: { flexDirection: 'row', gap: 6, marginBottom: 12, flexWrap: 'wrap' },
  catChip: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20,
    backgroundColor: Colors.fillTertiary,
  },
  catChipActive: { backgroundColor: Colors.primary },
  catChipText: { fontSize: 12, fontWeight: '600' as const, color: Colors.textSecondary },
  catChipTextActive: { color: Colors.textOnPrimary },
  modelList: { flex: 1 },
  modelCard: {
    backgroundColor: Colors.surface, borderRadius: 14, padding: 14, marginBottom: 8,
    borderWidth: 1, borderColor: Colors.cardBorder, gap: 10,
  },
  modelCardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  modelIconWrap: {
    width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
  },
  modelCardInfo: { flex: 1, gap: 2 },
  modelName: { fontSize: 15, fontWeight: '600' as const, color: Colors.text },
  modelDesc: { fontSize: 12, color: Colors.textMuted },
  modelCardBottom: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingTop: 6, borderTopWidth: 0.5, borderTopColor: Colors.borderLight,
  },
  modelRange: { fontSize: 14, fontWeight: '700' as const, color: Colors.success },
  modelSize: { fontSize: 11, color: Colors.textMuted },
  backBtn: { marginBottom: 8 },
  backBtnText: { fontSize: 13, color: Colors.primary, fontWeight: '600' as const },
  qualityGrid: { flexDirection: 'row', gap: 8, marginBottom: 16, marginTop: 4 },
  qualityCard: {
    flex: 1, backgroundColor: Colors.surface, borderRadius: 12, padding: 12,
    alignItems: 'center', gap: 4, borderWidth: 1.5, borderColor: Colors.cardBorder,
  },
  qualityCardActive: { borderColor: Colors.primary, backgroundColor: Colors.primary + '08' },
  qualityLabel: { fontSize: 12, fontWeight: '700' as const, color: Colors.textSecondary },
  qualityLabelActive: { color: Colors.primary },
  qualityRange: { fontSize: 14, fontWeight: '700' as const, color: Colors.text },
  qualityRangeActive: { color: Colors.primary },
  qualityUnit: { fontSize: 10, color: Colors.textMuted },
  qualityUnitActive: { color: Colors.primary },
  fieldLabel: { fontSize: 13, fontWeight: '600' as const, color: Colors.textSecondary, marginBottom: 6 },
  sqftRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 },
  sqftBtn: {
    width: 44, height: 44, borderRadius: 12, backgroundColor: Colors.primary + '12',
    alignItems: 'center', justifyContent: 'center',
  },
  sqftBtnText: { fontSize: 22, color: Colors.primary, fontWeight: '600' as const },
  sqftInput: {
    flex: 1, height: 48, backgroundColor: Colors.surface, borderRadius: 12,
    fontSize: 20, fontWeight: '700' as const, color: Colors.text,
    borderWidth: 1, borderColor: Colors.border,
  },
  presetRow: { flexDirection: 'row', gap: 6, marginBottom: 16 },
  presetChip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16,
    backgroundColor: Colors.fillTertiary,
  },
  presetText: { fontSize: 12, fontWeight: '500' as const, color: Colors.textSecondary },
  resultCard: {
    backgroundColor: Colors.surface, borderRadius: 16, padding: 16, gap: 12,
    borderWidth: 1, borderColor: Colors.primary + '30',
  },
  resultHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  resultTitle: { fontSize: 15, fontWeight: '700' as const, color: Colors.text },
  locationBadge: {
    backgroundColor: Colors.infoLight, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  locationText: { fontSize: 11, fontWeight: '600' as const, color: Colors.info },
  resultRow: { flexDirection: 'row', gap: 8 },
  resultCol: {
    flex: 1, backgroundColor: Colors.background, borderRadius: 12, padding: 12,
    alignItems: 'center', gap: 4,
  },
  resultColMid: { backgroundColor: Colors.primary + '10', borderWidth: 1, borderColor: Colors.primary + '25' },
  resultLabel: { fontSize: 10, fontWeight: '600' as const, color: Colors.textMuted, textTransform: 'uppercase' as const },
  resultValueLow: { fontSize: 16, fontWeight: '800' as const, color: Colors.success },
  resultValueMid: { fontSize: 16, fontWeight: '800' as const, color: Colors.primary },
  resultValueHigh: { fontSize: 16, fontWeight: '800' as const, color: Colors.error },
  resultPerSf: { fontSize: 10, color: Colors.textMuted },
  resultNotes: { fontSize: 11, color: Colors.textMuted, lineHeight: 16, fontStyle: 'italic' as const },
});
