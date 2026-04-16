import React, { useState, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, Modal, Platform,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { X, Search, Clock, Users, DollarSign, ChevronDown, ChevronUp } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { PRODUCTIVITY_RATES, PRODUCTIVITY_CATEGORIES, type ProductivityRate } from '@/constants/productivityRates';

interface ProductivityCalculatorProps {
  visible: boolean;
  onClose: () => void;
  onAddToEstimate?: (item: { name: string; materialCost: number; laborCost: number; equipmentCost: number; totalCost: number }) => void;
}

const ProductivityCalculator = React.memo(function ProductivityCalculator({ visible, onClose, onAddToEstimate }: ProductivityCalculatorProps) {
  const [query, setQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [selectedRate, setSelectedRate] = useState<ProductivityRate | null>(null);
  const [quantityInput, setQuantityInput] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filteredRates = useMemo(() => {
    let results = PRODUCTIVITY_RATES;
    if (selectedCategory !== 'all') results = results.filter(r => r.category === selectedCategory);
    if (query.trim()) {
      const q = query.toLowerCase();
      results = results.filter(r => r.task.toLowerCase().includes(q) || r.crew.toLowerCase().includes(q));
    }
    return results;
  }, [query, selectedCategory]);

  const handleSelect = useCallback((rate: ProductivityRate) => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedRate(rate);
    setQuantityInput('100');
  }, []);

  const qty = useMemo(() => parseFloat(quantityInput) || 0, [quantityInput]);

  const calculation = useMemo(() => {
    if (!selectedRate || qty <= 0) return null;
    const materialCost = selectedRate.materialCostPerUnit * qty;
    const laborCost = selectedRate.laborCostPerUnit * qty;
    const equipmentCost = selectedRate.equipmentCostPerUnit * qty;
    const totalCost = materialCost + laborCost + equipmentCost;
    const daysToComplete = selectedRate.dailyOutput > 0 ? qty / selectedRate.dailyOutput : 0;
    return { materialCost, laborCost, equipmentCost, totalCost, daysToComplete };
  }, [selectedRate, qty]);

  const handleAddToEstimate = useCallback(() => {
    if (!selectedRate || !calculation || !onAddToEstimate) return;
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onAddToEstimate({
      name: `${selectedRate.task} (${qty} ${selectedRate.unit})`,
      materialCost: calculation.materialCost,
      laborCost: calculation.laborCost,
      equipmentCost: calculation.equipmentCost,
      totalCost: calculation.totalCost,
    });
    setSelectedRate(null);
    setQuantityInput('');
    onClose();
  }, [selectedRate, calculation, qty, onAddToEstimate, onClose]);

  const handleClose = useCallback(() => {
    setSelectedRate(null);
    setQuery('');
    onClose();
  }, [onClose]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : undefined} onRequestClose={handleClose}>
      <View style={s.container}>
        <View style={s.header}>
          <View>
            <Text style={s.headerTitle}>Productivity Calc</Text>
            <Text style={s.headerSub}>Crew output & cost estimator</Text>
          </View>
          <TouchableOpacity onPress={handleClose} style={s.closeBtn}>
            <X size={20} color={Colors.text} />
          </TouchableOpacity>
        </View>

        {selectedRate ? (
          <ScrollView style={s.body} showsVerticalScrollIndicator={false}>
            <TouchableOpacity style={s.backBtn} onPress={() => setSelectedRate(null)}>
              <Text style={s.backBtnText}>← Select different task</Text>
            </TouchableOpacity>

            <Text style={s.taskTitle}>{selectedRate.task}</Text>

            <View style={s.crewCard}>
              <View style={s.crewRow}>
                <Users size={14} color={Colors.primary} />
                <Text style={s.crewLabel}>Crew:</Text>
                <Text style={s.crewValue}>{selectedRate.crew}</Text>
              </View>
              <View style={s.crewRow}>
                <Clock size={14} color={Colors.accent} />
                <Text style={s.crewLabel}>Daily Output:</Text>
                <Text style={s.crewValue}>{selectedRate.dailyOutput} {selectedRate.unit}/day</Text>
              </View>
            </View>

            <Text style={s.fieldLabel}>Quantity ({selectedRate.unit})</Text>
            <TextInput
              style={s.qtyInput}
              value={quantityInput}
              onChangeText={setQuantityInput}
              keyboardType="decimal-pad"
              textAlign="center"
              placeholder={`Enter ${selectedRate.unit}`}
              placeholderTextColor={Colors.textMuted}
            />

            {calculation && (
              <View style={s.resultCard}>
                <Text style={s.resultTitle}>Cost Breakdown</Text>

                <View style={s.costRow}>
                  <Text style={s.costLabel}>Materials</Text>
                  <Text style={s.costSub}>${selectedRate.materialCostPerUnit.toFixed(2)}/{selectedRate.unit}</Text>
                  <Text style={s.costValue}>${calculation.materialCost.toFixed(2)}</Text>
                </View>
                <View style={s.costRow}>
                  <Text style={s.costLabel}>Labor</Text>
                  <Text style={s.costSub}>${selectedRate.laborCostPerUnit.toFixed(2)}/{selectedRate.unit}</Text>
                  <Text style={s.costValue}>${calculation.laborCost.toFixed(2)}</Text>
                </View>
                <View style={s.costRow}>
                  <Text style={s.costLabel}>Equipment</Text>
                  <Text style={s.costSub}>${selectedRate.equipmentCostPerUnit.toFixed(2)}/{selectedRate.unit}</Text>
                  <Text style={s.costValue}>${calculation.equipmentCost.toFixed(2)}</Text>
                </View>

                <View style={s.divider} />

                <View style={s.totalRow}>
                  <Text style={s.totalLabel}>Total Cost</Text>
                  <Text style={s.totalValue}>${calculation.totalCost.toFixed(2)}</Text>
                </View>

                <View style={s.scheduleCard}>
                  <View style={s.scheduleRow}>
                    <Clock size={14} color={Colors.info} />
                    <Text style={s.scheduleLabel}>Estimated Duration:</Text>
                    <Text style={s.scheduleValue}>
                      {calculation.daysToComplete < 1
                        ? `${(calculation.daysToComplete * 8).toFixed(1)} hours`
                        : `${calculation.daysToComplete.toFixed(1)} days`}
                    </Text>
                  </View>
                  <View style={s.scheduleRow}>
                    <Users size={14} color={Colors.info} />
                    <Text style={s.scheduleLabel}>Crew:</Text>
                    <Text style={s.scheduleValue}>{selectedRate.crew}</Text>
                  </View>
                </View>

                {selectedRate.notes ? (
                  <Text style={s.notes}>{selectedRate.notes}</Text>
                ) : null}

                {onAddToEstimate && (
                  <TouchableOpacity style={s.addBtn} onPress={handleAddToEstimate} activeOpacity={0.85}>
                    <DollarSign size={16} color={Colors.textOnPrimary} />
                    <Text style={s.addBtnText}>Add to Estimate</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
            <View style={{ height: 40 }} />
          </ScrollView>
        ) : (
          <View style={s.body}>
            <View style={s.searchBar}>
              <Search size={16} color={Colors.textMuted} />
              <TextInput
                style={s.searchInput}
                value={query}
                onChangeText={setQuery}
                placeholder="Search tasks..."
                placeholderTextColor={Colors.textMuted}
              />
              {query.length > 0 && (
                <TouchableOpacity onPress={() => setQuery('')}>
                  <X size={14} color={Colors.textMuted} />
                </TouchableOpacity>
              )}
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.catScroll} contentContainerStyle={s.catContent}>
              {PRODUCTIVITY_CATEGORIES.map(cat => {
                const isActive = selectedCategory === cat.id;
                return (
                  <TouchableOpacity key={cat.id} style={[s.catChip, isActive && s.catChipActive]} onPress={() => setSelectedCategory(cat.id)}>
                    <Text style={[s.catChipText, isActive && s.catChipTextActive]}>{cat.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <ScrollView style={s.rateList} showsVerticalScrollIndicator={false}>
              {filteredRates.map(rate => {
                const isExpanded = expandedId === rate.id;
                const unitCost = rate.materialCostPerUnit + rate.laborCostPerUnit + rate.equipmentCostPerUnit;
                return (
                  <View key={rate.id} style={s.rateCard}>
                    <TouchableOpacity style={s.rateCardTop} onPress={() => handleSelect(rate)} activeOpacity={0.7}>
                      <View style={s.rateInfo}>
                        <Text style={s.rateName}>{rate.task}</Text>
                        <Text style={s.rateCrew}>{rate.crew}</Text>
                      </View>
                      <View style={s.rateRight}>
                        <Text style={s.rateUnitCost}>${unitCost.toFixed(2)}</Text>
                        <Text style={s.rateUnit}>/{rate.unit}</Text>
                      </View>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={s.expandToggle}
                      onPress={() => setExpandedId(isExpanded ? null : rate.id)}
                    >
                      <Text style={s.expandText}>{rate.dailyOutput} {rate.unit}/day</Text>
                      {isExpanded ? <ChevronUp size={12} color={Colors.textMuted} /> : <ChevronDown size={12} color={Colors.textMuted} />}
                    </TouchableOpacity>
                    {isExpanded && (
                      <View style={s.expandedContent}>
                        <Text style={s.expandedRow}>Mat: ${rate.materialCostPerUnit.toFixed(2)} · Lab: ${rate.laborCostPerUnit.toFixed(2)} · Equip: ${rate.equipmentCostPerUnit.toFixed(2)}</Text>
                        {rate.notes ? <Text style={s.expandedNotes}>{rate.notes}</Text> : null}
                      </View>
                    )}
                  </View>
                );
              })}
              <View style={{ height: 20 }} />
            </ScrollView>
          </View>
        )}
      </View>
    </Modal>
  );
});

export default ProductivityCalculator;

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
  backBtn: { marginBottom: 8 },
  backBtnText: { fontSize: 13, color: Colors.primary, fontWeight: '600' as const },
  taskTitle: { fontSize: 20, fontWeight: '700' as const, color: Colors.text, marginBottom: 12 },
  searchBar: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.fillTertiary,
    borderRadius: 12, paddingHorizontal: 12, gap: 8, height: 42, marginBottom: 8,
  },
  searchInput: { flex: 1, fontSize: 14, color: Colors.text },
  catScroll: { maxHeight: 40, marginBottom: 8 },
  catContent: { gap: 6, paddingRight: 16 },
  catChip: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, backgroundColor: Colors.fillTertiary,
  },
  catChipActive: { backgroundColor: Colors.primary },
  catChipText: { fontSize: 12, fontWeight: '600' as const, color: Colors.textSecondary },
  catChipTextActive: { color: Colors.textOnPrimary },
  rateList: { flex: 1 },
  rateCard: {
    backgroundColor: Colors.surface, borderRadius: 12, marginBottom: 6,
    borderWidth: 1, borderColor: Colors.cardBorder, overflow: 'hidden' as const,
  },
  rateCardTop: { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 10 },
  rateInfo: { flex: 1, gap: 2 },
  rateName: { fontSize: 14, fontWeight: '600' as const, color: Colors.text },
  rateCrew: { fontSize: 11, color: Colors.textMuted },
  rateRight: { alignItems: 'flex-end' },
  rateUnitCost: { fontSize: 15, fontWeight: '700' as const, color: Colors.success },
  rateUnit: { fontSize: 10, color: Colors.textMuted },
  expandToggle: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingBottom: 8, gap: 6,
  },
  expandText: { fontSize: 11, color: Colors.info, fontWeight: '500' as const },
  expandedContent: {
    padding: 12, paddingTop: 8, borderTopWidth: 0.5, borderTopColor: Colors.borderLight,
    backgroundColor: Colors.surfaceAlt, gap: 4,
  },
  expandedRow: { fontSize: 11, color: Colors.textSecondary },
  expandedNotes: { fontSize: 11, color: Colors.textMuted, fontStyle: 'italic' as const },
  crewCard: {
    backgroundColor: Colors.surface, borderRadius: 12, padding: 14, gap: 10, marginBottom: 16,
    borderWidth: 1, borderColor: Colors.cardBorder,
  },
  crewRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  crewLabel: { fontSize: 13, fontWeight: '600' as const, color: Colors.textSecondary },
  crewValue: { fontSize: 13, fontWeight: '600' as const, color: Colors.text },
  fieldLabel: { fontSize: 13, fontWeight: '600' as const, color: Colors.textSecondary, marginBottom: 6 },
  qtyInput: {
    height: 52, backgroundColor: Colors.surface, borderRadius: 12, fontSize: 22,
    fontWeight: '700' as const, color: Colors.text, borderWidth: 1, borderColor: Colors.border, marginBottom: 16,
  },
  resultCard: {
    backgroundColor: Colors.surface, borderRadius: 16, padding: 16, gap: 10,
    borderWidth: 1, borderColor: Colors.primary + '30',
  },
  resultTitle: { fontSize: 16, fontWeight: '700' as const, color: Colors.text },
  costRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8,
  },
  costLabel: { fontSize: 14, color: Colors.textSecondary, width: 80 },
  costSub: { flex: 1, fontSize: 11, color: Colors.textMuted },
  costValue: { fontSize: 14, fontWeight: '600' as const, color: Colors.text },
  divider: { height: 1, backgroundColor: Colors.borderLight },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  totalLabel: { fontSize: 16, fontWeight: '700' as const, color: Colors.text },
  totalValue: { fontSize: 22, fontWeight: '800' as const, color: Colors.primary },
  scheduleCard: {
    backgroundColor: Colors.infoLight, borderRadius: 10, padding: 12, gap: 8,
  },
  scheduleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  scheduleLabel: { fontSize: 12, color: Colors.info, fontWeight: '500' as const },
  scheduleValue: { fontSize: 12, fontWeight: '700' as const, color: Colors.info },
  notes: { fontSize: 11, color: Colors.textMuted, lineHeight: 16, fontStyle: 'italic' as const },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, marginTop: 4,
  },
  addBtnText: { fontSize: 16, fontWeight: '700' as const, color: Colors.textOnPrimary },
});
