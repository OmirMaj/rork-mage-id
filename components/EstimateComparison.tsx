import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Modal, Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { X, GitCompare, TrendingUp, TrendingDown, Minus, Save, Clock } from 'lucide-react-native';
import { Colors, type ThemeColors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { MaterialItem } from '@/constants/materials';
import type { LaborRate } from '@/constants/laborRates';
import type { AssemblyItem } from '@/constants/assemblies';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { showAlert } from '@/utils/alert';

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
  items: { id: string; name: string; category: string; total: number; quantity: number }[];
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

// This device keeps ten saved versions. The eleventh save used to push the
// oldest off the end silently — a GC who saved V1 as the number he had already
// quoted the client found it gone months later with nothing having said so.
// The cap stays (this is one AsyncStorage blob, not a synced table); what
// changes is that the save now asks first and names what it is about to drop.
const MAX_SAVED_VERSIONS = 10;

/**
 * The next "V<n>" name, taken from the highest number already on the list —
 * NOT from its length.
 *
 * Length is wrong twice. Once the list is full every further save pushes one
 * off the end, so the count sticks at ten and every save from the eleventh on
 * is called "V11": two versions with the same name, and a GC comparing "V11"
 * against the quote he emailed has no way to tell which one he is reading.
 * Deleting a version does the same thing sooner — save V1, V2, V3, delete V2,
 * and the next save is a second "V3".
 *
 * Names are the only handle these rows have, so a number is never reused while
 * the version wearing it is still on the list.
 */
function nextVersionNumber(saved: { name: string }[]): number {
  let highest = 0;
  for (const v of saved) {
    const m = /^V(\d+)\b/.exec(v.name);
    if (m) highest = Math.max(highest, Number(m[1]));
  }
  // A list of hand-renamed versions yields no number at all; falling back to
  // the count keeps the first save after that from being "V1" on a full list.
  return Math.max(highest, saved.length) + 1;
}

function formatDelta(current: number, saved: number): { text: string; color: string; icon: typeof TrendingUp } {
  const delta = current - saved;
  const pct = saved > 0 ? ((delta / saved) * 100).toFixed(1) : '0.0';
  if (delta > 0) return { text: `+$${delta.toFixed(0)} (+${pct}%)`, color: Colors.dangerLabel, icon: TrendingUp };
  if (delta < 0) return { text: `-$${Math.abs(delta).toFixed(0)} (${pct}%)`, color: Colors.successLabel, icon: TrendingDown };
  return { text: '$0 (0%)', color: Colors.textMuted, icon: Minus };
}

const EstimateComparison = React.memo(function EstimateComparison({
  visible, onClose,
  currentCart, currentLaborCart, currentAssemblyCart,
  currentMaterialsTotal, currentLaborTotal, currentAssemblyTotal, currentGrandTotal,
}: EstimateComparisonProps) {
  // Built per theme — the comparison sheet baked its page background, card
  // and ink at import (audit 2026-09-07).
  const s = useThemedStyles(makeStyles);
  const { colors: t } = useTheme();
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
      showAlert('Nothing to Save', 'Add items to your estimate first.');
      return;
    }
    const items = currentCart.map(i => ({
      id: i.material.id,
      name: i.material.name,
      category: i.material.category,
      total: (i.usesBulk ? i.material.baseBulkPrice : i.material.baseRetailPrice) * (1 + i.markup / 100) * i.quantity,
      quantity: i.quantity,
    }));

    const version: SavedEstimateVersion = {
      id: `v-${Date.now()}`,
      name: `V${nextVersionNumber(savedVersions)} — ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
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

    const queued = [version, ...savedVersions];
    const updated = queued.slice(0, MAX_SAVED_VERSIONS);
    // Whatever this save pushes off the end. Named before the fact, because
    // "your oldest version was deleted" is not something to discover on the
    // day you go looking for it.
    const evicted = queued.slice(MAX_SAVED_VERSIONS);

    // The success alert and the success haptic used to fire unconditionally,
    // outside the try — so a failed write announced "Saved" and the version
    // was gone the next time this sheet opened, with nothing said (audit
    // 2026-09-07, the honesty gap). Only the branch that actually wrote is
    // allowed to claim it — and the in-memory list is only updated after the
    // write lands, so a failed save leaves no row sitting there looking saved.
    const write = async () => {
      try {
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      } catch (err) {
        console.error('[EstimateComparison] Failed to save version:', err);
        showAlert('Couldn’t save', `This device would not store the version: ${err instanceof Error ? err.message : 'unknown error'}. Your estimate itself is untouched — try again.`);
        return;
      }
      setSavedVersions(updated);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const note = evicted.length > 0
        ? `Estimate saved as "${version.name}". ${evicted.map(v => `"${v.name}"`).join(', ')} dropped off the end.`
        : `Estimate saved as "${version.name}"`;
      showAlert('Saved', note);
    };

    if (evicted.length === 0) { await write(); return; }
    // The list is newest-first, so the OLDEST evicted version is the last one,
    // not the first. A stored list longer than the cap (written by a build
    // before the cap, or by a cap that was higher) drops several at once, and
    // naming only evicted[0] would name a version that is not the oldest while
    // the sentence claims it is.
    const dropped = evicted[evicted.length - 1];
    const alsoDropped = evicted.length > 1
      ? ` and ${evicted.length - 1} other${evicted.length > 2 ? 's' : ''}`
      : '';
    showAlert(
      'Saving this drops your oldest version',
      `This device keeps ${MAX_SAVED_VERSIONS} versions. Saving "${version.name}" removes `
        + `"${dropped.name}" ($${Math.round(dropped.grandTotal).toLocaleString('en-US')}, saved `
        + `${new Date(dropped.savedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })})`
        + `${alsoDropped}. `
        + 'It is only on this device, so it cannot be recovered afterwards.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Save anyway', style: 'destructive', onPress: () => { void write(); } },
      ],
    );
  }, [currentCart, currentLaborCart, currentAssemblyCart, currentMaterialsTotal, currentLaborTotal, currentAssemblyTotal, currentGrandTotal, savedVersions]);

  const handleDeleteVersion = useCallback(async (id: string) => {
    const updated = savedVersions.filter(v => v.id !== id);
    // Same rule as the save above: the row leaves the list only if the write
    // that removes it landed. It used to vanish on screen and come back on
    // the next open.
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch (err) {
      console.error('[EstimateComparison] Failed to delete version:', err);
      showAlert('Couldn’t delete', `This device would not update the saved versions: ${err instanceof Error ? err.message : 'unknown error'}. The version is still there — try again.`);
      return;
    }
    setSavedVersions(updated);
    if (selectedVersion?.id === id) setSelectedVersion(null);
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

    const changedItems: { name: string; currentTotal: number; savedTotal: number; type: 'changed' | 'new' | 'removed' }[] = [];

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
          <TouchableOpacity onPress={onClose} style={s.closeBtn} accessibilityRole="button" accessibilityLabel="Close"><X size={20} color={t.text} strokeWidth={1.75} /></TouchableOpacity>
        </View>

        <ScrollView style={s.body} showsVerticalScrollIndicator={false}>
          <TouchableOpacity style={s.saveBtn} onPress={handleSaveCurrentVersion} activeOpacity={0.85}>
            <Save size={16} color={Colors.textOnPrimary} strokeWidth={1.75} />
            <Text style={s.saveBtnText}>Save Current as Version</Text>
          </TouchableOpacity>

          {savedVersions.length === 0 && !loading && (
            <View style={s.emptyState}>
              <GitCompare size={40} color={t.textMuted} strokeWidth={1.75} />
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
                          <Clock size={10} color={t.textMuted} strokeWidth={1.75} />
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
                        <X size={12} color={t.dangerLabel} strokeWidth={1.75} />
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
                    <Text style={[s.compCell, { color: t.textMuted }]}>${row.saved.toFixed(0)}</Text>
                    <Text style={[s.compCell, { color: row.delta.color, fontWeight: '600' as const, fontSize: Type.caption2.fontSize }]}>{row.delta.text}</Text>
                  </View>
                ))}

                <View style={s.compDivider} />
                <View style={s.compRow}>
                  <Text style={[s.compCell, { flex: 2, fontWeight: '700' as const, fontSize: Type.bodyCompact.fontSize }]}>Grand Total</Text>
                  <Text style={[s.compCell, { fontWeight: '700' as const, color: Colors.primary }]}>${currentGrandTotal.toFixed(0)}</Text>
                  <Text style={[s.compCell, { color: t.textMuted }]}>${selectedVersion.grandTotal.toFixed(0)}</Text>
                  <Text style={[s.compCell, { color: comparison.totalDelta.color, fontWeight: '700' as const, fontSize: Type.caption1.fontSize }]}>{comparison.totalDelta.text}</Text>
                </View>
              </View>

              {comparison.changedItems.length > 0 && (
                <View style={s.changesSection}>
                  <Text style={s.changesSectionTitle}>Line Item Changes</Text>
                  {comparison.changedItems.slice(0, 15).map((item, idx) => {
                    const bgColor = item.type === 'new' ? Colors.successLight : item.type === 'removed' ? Colors.errorLight : Colors.warningLight;
                    const textColor = item.type === 'new' ? t.successLabel : item.type === 'removed' ? t.dangerLabel : t.warningLabel;
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

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12,
    backgroundColor: t.surface, borderBottomWidth: 0.5, borderBottomColor: t.line,
  },
  headerTitle: { fontSize: Type.title2.fontSize, fontWeight: '700' as const, color: t.text, letterSpacing: -0.3 },
  headerSub: { fontSize: Type.footnote.fontSize, color: t.textSecondary, marginTop: 2 },
  closeBtn: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: t.neutralSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  body: { flex: 1, paddingHorizontal: 16, paddingTop: 12 },
  saveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.primary, borderRadius: Tokens.radius.lg, paddingVertical: 14, marginBottom: 16,
  },
  saveBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: Colors.textOnPrimary },
  emptyState: { alignItems: 'center', paddingVertical: 40, gap: 10 },
  emptyTitle: { fontSize: Type.body.fontSize, fontWeight: '600' as const, color: t.text },
  emptyDesc: { fontSize: Type.footnote.fontSize, color: t.textMuted, textAlign: 'center' as const, lineHeight: 18 },
  sectionTitle: {
    fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: t.text, marginBottom: 8, marginTop: 4,
  },
  versionCard: {
    backgroundColor: t.surface, borderRadius: Tokens.radius.card, padding: 14, marginBottom: 8,
    borderWidth: 1.5, borderColor: t.line, gap: 8,
  },
  versionCardSelected: { borderColor: Colors.primary, backgroundColor: Colors.primary + '06' },
  versionTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  versionInfo: { flex: 1, gap: 3 },
  versionName: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600' as const, color: t.text },
  versionNameSelected: { color: Colors.primary },
  versionMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  versionDate: { fontSize: Type.caption2.fontSize, color: t.textMuted },
  versionRight: { alignItems: 'flex-end', gap: 2 },
  versionTotal: { fontSize: Type.callout.fontSize, fontWeight: '700' as const, color: t.text },
  versionTotalSelected: { color: Colors.primary },
  versionCount: { fontSize: 10, color: t.textMuted },
  deleteBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-end' as const,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: Tokens.radius.xs, backgroundColor: Colors.errorLight,
  },
  deleteBtnText: { fontSize: Type.caption2.fontSize, fontWeight: '600' as const, color: t.dangerLabel },
  comparisonSection: { marginTop: 8, gap: 8 },
  compTable: {
    backgroundColor: t.surface, borderRadius: Tokens.radius.card, borderWidth: 1, borderColor: t.line,
    overflow: 'hidden' as const,
  },
  compHeader: {
    flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 8,
    backgroundColor: t.neutralSoft, gap: 4,
  },
  compHeaderCell: {
    flex: 1, fontSize: 10, fontWeight: '700' as const, color: t.textMuted,
    textTransform: 'uppercase' as const, letterSpacing: 0.3, textAlign: 'right' as const,
  },
  compRow: {
    flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 10,
    borderTopWidth: 0.5, borderTopColor: t.line, alignItems: 'center', gap: 4,
  },
  compCell: { flex: 1, fontSize: Type.caption1.fontSize, color: t.textSecondary, textAlign: 'right' as const },
  compDivider: { height: 1, backgroundColor: t.line, marginHorizontal: 12 },
  changesSection: { marginTop: 12, gap: 6 },
  changesSectionTitle: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: t.text, marginBottom: 2 },
  changeRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderRadius: Tokens.radius.md, padding: 10, gap: 8,
  },
  changeInfo: { flex: 1, gap: 4 },
  changeName: { fontSize: Type.caption1.fontSize, fontWeight: '500' as const, color: t.text },
  changeBadge: { alignSelf: 'flex-start' as const },
  changeBadgeText: { fontSize: 9, fontWeight: '700' as const, letterSpacing: 0.5 },
  changeAmounts: { alignItems: 'flex-end', gap: 2 },
  changeOld: { fontSize: Type.caption2.fontSize, color: t.textMuted, textDecorationLine: 'line-through' as const },
  changeNew: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const },
});
