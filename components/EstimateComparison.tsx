import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Modal, Platform, Alert,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { X, GitCompare, TrendingUp, TrendingDown, Minus, Save, Clock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { MaterialItem } from '@/constants/materials';
import type { LaborRate } from '@/constants/laborRates';
import type { AssemblyItem } from '@/constants/assemblies';

interface CartItem {
  material: MaterialItem;
  quantity: number;
  markup: number;
  usesBulk: boolean;
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

interface SavedEstimateVersion {
  id: string;
  name: string;
  savedAt: string;
  materialsTotal: number;
  laborTotal: number;
  assemblyTotal: number;
  grandTotal: number;
  materialCount: number;
  laborCount: number;
  assemblyCount: number;
  items: Array<{ id: string; name: string; category: string; total: number; quantity: number }>;
}

interface EstimateComparisonProps {
  visible: boolean;
  onClose: () => void;
  currentCart: CartItem[];
  currentLaborCart: LaborCartItem[];
  currentAssemblyCart: AssemblyCartItem[];
  currentMaterialsTotal: number;
  currentLaborTotal: number;
  currentAssemblyTotal: number;
  currentGrandTotal: number;
}

const STORAGE_KEY = 'mageid_estimate_versions';

function formatDelta(current: number, saved: number): { text: string; color: string; icon: typeof TrendingUp } {
  const delta = current - saved;
  const pct = saved > 0 ? ((delta / saved) * 100).toFixed(1) : '0.0';
  if (delta > 0) return { text: `+$${delta.toFixed(0)} (+${pct}%)`, color: Colors.error, icon: TrendingUp };
  if (delta < 0) return { text: `-$${Math.abs(delta).toFixed(0)} (${pct}%)`, color: Colors.success, icon: TrendingDown };
  return { text: '$0 (0%)', color: Colors.textMuted, icon: Minus };
}

const EstimateComparison = React.memo(function EstimateComparison({
  visible, onClose,
  currentCart, currentLaborCart, currentAssemblyCart,
  currentMaterialsTotal, currentLaborTotal, currentAssemblyTotal, currentGrandTotal,
}: EstimateComparisonProps) {
  const [savedVersions, setSavedVersions] = useState<SavedEstimateVersion[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<SavedEstimateVersion | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (visible) {
      loadVersions();
    }
  }, [visible]);

  const loadVersions = useCallback(async () => {
    setLoading(true);
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) {
        setSavedVersions(JSON.parse(stored));
      }
    } catch (err) {
      console.error('[EstimateComparison] Failed to load versions:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSaveCurrentVersion = useCallback(async () => {
    if (currentGrandTotal <= 0) {
      Alert.alert('Nothing to Save', 'Add items to your estimate first.');
      return;
    }
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    const items = currentCart.map(i => ({
      id: i.material.id,
      name: i.material.name,
      category: i.material.category,
      total: (i.usesBulk ? i.material.baseBulkPrice : i.material.baseRetailPrice) * (1 + i.markup / 100) * i.quantity,
      quantity: i.quantity,
    }));

    const version: SavedEstimateVersion = {
      id: `v-${Date.now()}`,
      name: `V${savedVersions.length + 1} — ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
      savedAt: new Date().toISOString(),
      materialsTotal: currentMaterialsTotal,
      laborTotal: currentLaborTotal,
      assemblyTotal: currentAssemblyTotal,
      grandTotal: currentGrandTotal,
      materialCount: currentCart.length,
      laborCount: currentLaborCart.length,
      assemblyCount: currentAssemblyCart.length,
      items,
    };

    const updated = [version, ...savedVersions].slice(0, 10);
    setSavedVersions(updated);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch (err) {
      console.error('[EstimateComparison] Failed to save version:', err);
    }
    Alert.alert('Saved', `Estimate saved as "${version.name}"`);
  }, [currentCart, currentLaborCart, currentAssemblyCart, currentMaterialsTotal, currentLaborTotal, currentAssemblyTotal, currentGrandTotal, savedVersions]);

  const handleDeleteVersion = useCallback(async (id: string) => {
    const updated = savedVersions.filter(v => v.id !== id);
    setSavedVersions(updated);
    if (selectedVersion?.id === id) setSelectedVersion(null);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch (err) {
      console.error('[EstimateComparison] Failed to delete version:', err);
    }
  }, [savedVersions, selectedVersion]);

  const comparison = useMemo(() => {
    if (!selectedVersion) return null;
    const matDelta = formatDelta(currentMaterialsTotal, selectedVersion.materialsTotal);
    const labDelta = formatDelta(currentLaborTotal, selectedVersion.laborTotal);
    const asmDelta = formatDelta(currentAssemblyTotal, selectedVersion.assemblyTotal);
    const totalDelta = formatDelta(currentGrandTotal, selectedVersion.grandTotal);

    const currentItemMap = new Map(currentCart.map(i => {
      const total = (i.usesBulk ? i.material.baseBulkPrice : i.material.baseRetailPrice) * (1 + i.markup / 100) * i.quantity;
      return [i.material.id, { name: i.material.name, total, quantity: i.quantity }];
    }));
    const savedItemMap = new Map(selectedVersion.items.map(i => [i.id, i]));

    const changedItems: Array<{ name: string; currentTotal: number; savedTotal: number; type: 'changed' | 'new' | 'removed' }> = [];

    for (const [id, curr] of currentItemMap) {
      const saved = savedItemMap.get(id);
      if (!saved) {
        changedItems.push({ name: curr.name, currentTotal: curr.total, savedTotal: 0, type: 'new' });
      } else if (Math.abs(curr.total - saved.total) > 0.50) {
        changedItems.push({ name: curr.name, currentTotal: curr.total, savedTotal: saved.total, type: 'changed' });
      }
    }
    for (const [id, saved] of savedItemMap) {
      if (!currentItemMap.has(id)) {
        changedItems.push({ name: saved.name, currentTotal: 0, savedTotal: saved.total, type: 'removed' });
      }
    }

    return { matDelta, labDelta, asmDelta, totalDelta, changedItems };
  }, [selectedVersion, currentMaterialsTotal, currentLaborTotal, currentAssemblyTotal, currentGrandTotal, currentCart]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : undefined} onRequestClose={onClose}>
      <View style={s.container}>
        <View style={s.header}>
          <View>
            <Text style={s.headerTitle}>Compare Estimates</Text>
            <Text style={s.headerSub}>Track changes across versions</Text>
          </View>
          <TouchableOpacity onPress={onClose} style={s.closeBtn}>
            <X size={20} color={Colors.text} />
          </TouchableOpacity>
        </View>

        <ScrollView style={s.body} showsVerticalScrollIndicator={false}>
          <TouchableOpacity style={s.saveBtn} onPress={handleSaveCurrentVersion} activeOpacity={0.85}>
            <Save size={16} color={Colors.textOnPrimary} />
            <Text style={s.saveBtnText}>Save Current as Version</Text>
          </TouchableOpacity>

          {savedVersions.length === 0 && !loading && (
            <View style={s.emptyState}>
              <GitCompare size={40} color={Colors.textMuted} />
              <Text style={s.emptyTitle}>No saved versions yet</Text>
              <Text style={s.emptyDesc}>Save your current estimate to start tracking changes over time.</Text>
            </View>
          )}

          {savedVersions.length > 0 && (
            <>
              <Text style={s.sectionTitle}>Saved Versions</Text>
              {savedVersions.map(version => {
                const isSelected = selectedVersion?.id === version.id;
                return (
                  <TouchableOpacity
                    key={version.id}
                    style={[s.versionCard, isSelected && s.versionCardSelected]}
                    onPress={() => {
                      setSelectedVersion(isSelected ? null : version);
                      if (Platform.OS !== 'web') void Haptics.selectionAsync();
                    }}
                    activeOpacity={0.7}
                  >
                    <View style={s.versionTop}>
                      <View style={s.versionInfo}>
                        <Text style={[s.versionName, isSelected && s.versionNameSelected]}>{version.name}</Text>
                        <View style={s.versionMeta}>
                          <Clock size={10} color={Colors.textMuted} />
                          <Text style={s.versionDate}>
                            {new Date(version.savedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </Text>
                        </View>
                      </View>
                      <View style={s.versionRight}>
                        <Text style={[s.versionTotal, isSelected && s.versionTotalSelected]}>${version.grandTotal.toFixed(0)}</Text>
                        <Text style={s.versionCount}>{version.materialCount + version.laborCount + version.assemblyCount} items</Text>
                      </View>
                    </View>
                    {isSelected && (
                      <TouchableOpacity
                        style={s.deleteBtn}
                        onPress={() => handleDeleteVersion(version.id)}
                      >
                        <X size={12} color={Colors.error} />
                        <Text style={s.deleteBtnText}>Delete</Text>
                      </TouchableOpacity>
                    )}
                  </TouchableOpacity>
                );
              })}
            </>
          )}

          {comparison && selectedVersion && (
            <View style={s.comparisonSection}>
              <Text style={s.sectionTitle}>Comparison</Text>
              <View style={s.compTable}>
                <View style={s.compHeader}>
                  <Text style={[s.compHeaderCell, { flex: 2 }]} />
                  <Text style={s.compHeaderCell}>Current</Text>
                  <Text style={s.compHeaderCell}>{selectedVersion.name}</Text>
                  <Text style={s.compHeaderCell}>Delta</Text>
                </View>

                {[
                  { label: 'Materials', current: currentMaterialsTotal, saved: selectedVersion.materialsTotal, delta: comparison.matDelta },
                  { label: 'Labor', current: currentLaborTotal, saved: selectedVersion.laborTotal, delta: comparison.labDelta },
                  { label: 'Assemblies', current: currentAssemblyTotal, saved: selectedVersion.assemblyTotal, delta: comparison.asmDelta },
                ].map(row => (
                  <View key={row.label} style={s.compRow}>
                    <Text style={[s.compCell, { flex: 2, fontWeight: '600' as const }]}>{row.label}</Text>
                    <Text style={s.compCell}>${row.current.toFixed(0)}</Text>
                    <Text style={[s.compCell, { color: Colors.textMuted }]}>${row.saved.toFixed(0)}</Text>
                    <Text style={[s.compCell, { color: row.delta.color, fontWeight: '600' as const, fontSize: 11 }]}>{row.delta.text}</Text>
                  </View>
                ))}

                <View style={s.compDivider} />
                <View style={s.compRow}>
                  <Text style={[s.compCell, { flex: 2, fontWeight: '700' as const, fontSize: 14 }]}>Grand Total</Text>
                  <Text style={[s.compCell, { fontWeight: '700' as const, color: Colors.primary }]}>${currentGrandTotal.toFixed(0)}</Text>
                  <Text style={[s.compCell, { color: Colors.textMuted }]}>${selectedVersion.grandTotal.toFixed(0)}</Text>
                  <Text style={[s.compCell, { color: comparison.totalDelta.color, fontWeight: '700' as const, fontSize: 12 }]}>{comparison.totalDelta.text}</Text>
                </View>
              </View>

              {comparison.changedItems.length > 0 && (
                <View style={s.changesSection}>
                  <Text style={s.changesSectionTitle}>Line Item Changes</Text>
                  {comparison.changedItems.slice(0, 15).map((item, idx) => {
                    const bgColor = item.type === 'new' ? Colors.successLight : item.type === 'removed' ? Colors.errorLight : Colors.warningLight;
                    const textColor = item.type === 'new' ? Colors.success : item.type === 'removed' ? Colors.error : Colors.warning;
                    const label = item.type === 'new' ? 'NEW' : item.type === 'removed' ? 'REMOVED' : 'CHANGED';
                    return (
                      <View key={`${item.name}-${idx}`} style={[s.changeRow, { backgroundColor: bgColor }]}>
                        <View style={s.changeInfo}>
                          <Text style={s.changeName} numberOfLines={1}>{item.name}</Text>
                          <View style={s.changeBadge}>
                            <Text style={[s.changeBadgeText, { color: textColor }]}>{label}</Text>
                          </View>
                        </View>
                        <View style={s.changeAmounts}>
                          {item.type !== 'new' && <Text style={s.changeOld}>${item.savedTotal.toFixed(0)}</Text>}
                          {item.type !== 'removed' && <Text style={[s.changeNew, { color: textColor }]}>${item.currentTotal.toFixed(0)}</Text>}
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}
            </View>
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      </View>
    </Modal>
  );
});

export default EstimateComparison;

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
  saveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, marginBottom: 16,
  },
  saveBtnText: { fontSize: 15, fontWeight: '700' as const, color: Colors.textOnPrimary },
  emptyState: { alignItems: 'center', paddingVertical: 40, gap: 10 },
  emptyTitle: { fontSize: 17, fontWeight: '600' as const, color: Colors.text },
  emptyDesc: { fontSize: 13, color: Colors.textMuted, textAlign: 'center' as const, lineHeight: 18 },
  sectionTitle: {
    fontSize: 15, fontWeight: '700' as const, color: Colors.text, marginBottom: 8, marginTop: 4,
  },
  versionCard: {
    backgroundColor: Colors.surface, borderRadius: 12, padding: 14, marginBottom: 8,
    borderWidth: 1.5, borderColor: Colors.cardBorder, gap: 8,
  },
  versionCardSelected: { borderColor: Colors.primary, backgroundColor: Colors.primary + '06' },
  versionTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  versionInfo: { flex: 1, gap: 3 },
  versionName: { fontSize: 14, fontWeight: '600' as const, color: Colors.text },
  versionNameSelected: { color: Colors.primary },
  versionMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  versionDate: { fontSize: 11, color: Colors.textMuted },
  versionRight: { alignItems: 'flex-end', gap: 2 },
  versionTotal: { fontSize: 16, fontWeight: '700' as const, color: Colors.text },
  versionTotalSelected: { color: Colors.primary },
  versionCount: { fontSize: 10, color: Colors.textMuted },
  deleteBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-end' as const,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: Colors.errorLight,
  },
  deleteBtnText: { fontSize: 11, fontWeight: '600' as const, color: Colors.error },
  comparisonSection: { marginTop: 8, gap: 8 },
  compTable: {
    backgroundColor: Colors.surface, borderRadius: 12, borderWidth: 1, borderColor: Colors.cardBorder,
    overflow: 'hidden' as const,
  },
  compHeader: {
    flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 8,
    backgroundColor: Colors.fillSecondary, gap: 4,
  },
  compHeaderCell: {
    flex: 1, fontSize: 10, fontWeight: '700' as const, color: Colors.textMuted,
    textTransform: 'uppercase' as const, letterSpacing: 0.3, textAlign: 'right' as const,
  },
  compRow: {
    flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 10,
    borderTopWidth: 0.5, borderTopColor: Colors.borderLight, alignItems: 'center', gap: 4,
  },
  compCell: { flex: 1, fontSize: 12, color: Colors.textSecondary, textAlign: 'right' as const },
  compDivider: { height: 1, backgroundColor: Colors.border, marginHorizontal: 12 },
  changesSection: { marginTop: 12, gap: 6 },
  changesSectionTitle: { fontSize: 13, fontWeight: '700' as const, color: Colors.text, marginBottom: 2 },
  changeRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderRadius: 10, padding: 10, gap: 8,
  },
  changeInfo: { flex: 1, gap: 4 },
  changeName: { fontSize: 12, fontWeight: '500' as const, color: Colors.text },
  changeBadge: { alignSelf: 'flex-start' as const },
  changeBadgeText: { fontSize: 9, fontWeight: '700' as const, letterSpacing: 0.5 },
  changeAmounts: { alignItems: 'flex-end', gap: 2 },
  changeOld: { fontSize: 11, color: Colors.textMuted, textDecorationLine: 'line-through' as const },
  changeNew: { fontSize: 13, fontWeight: '700' as const },
});
