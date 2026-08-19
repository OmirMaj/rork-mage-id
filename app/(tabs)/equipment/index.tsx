import React, { useState, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, Modal, TextInput, KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  Truck, Plus, AlertTriangle, X, ChevronDown, Crown,
} from 'lucide-react-native';
import { MageEquipment } from '@/components/icons';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useProjects } from '@/contexts/ProjectContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import EmptyState from '@/components/EmptyState';
import type { EquipmentCategory } from '@/types';
import { EQUIPMENT_CATEGORIES } from '@/types';
import { formatMoney } from '@/utils/formatters';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { showAlert } from '@/utils/alert';

type FilterType = 'all' | 'available' | 'in_use' | 'maintenance';

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  available: { label: 'Available', color: Colors.success },
  in_use: { label: 'In Use', color: Colors.info },
  maintenance: { label: 'Maintenance', color: Colors.warning },
  retired: { label: 'Retired', color: Colors.textMuted },
};

export default function EquipmentScreen() {
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const router = useRouter();
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { equipment, addEquipment, getProject } = useProjects();
  const { isProOrAbove } = useSubscription();
  const { canAccess } = useTierAccess();

  const [filter, setFilter] = useState<FilterType>('all');
  const [showAddModal, setShowAddModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newMake, setNewMake] = useState('');
  const [newModel, setNewModel] = useState('');
  const [newType, setNewType] = useState<'owned' | 'rented'>('owned');
  const [newCategory, setNewCategory] = useState<EquipmentCategory>('other');
  const [newDailyRate, setNewDailyRate] = useState('');
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);

  const stats = useMemo(() => ({
    total: equipment.length,
    inUse: equipment.filter(e => e.status === 'in_use').length,
    overdueCount: equipment.filter(e =>
      e.maintenanceSchedule.some(m => m.isOverdue)
    ).length,
  }), [equipment]);

  const filteredEquipment = useMemo(() => {
    if (filter === 'all') return equipment;
    return equipment.filter(e => e.status === filter);
  }, [equipment, filter]);

  const handleAdd = useCallback(() => {
    if (!newName.trim()) {
      showAlert('Missing Name', 'Please enter an equipment name.');
      return;
    }
    addEquipment({
      name: newName.trim(),
      type: newType,
      category: newCategory,
      make: newMake.trim(),
      model: newModel.trim(),
      dailyRate: parseFloat(newDailyRate) || 0,
      maintenanceSchedule: [],
      utilizationLog: [],
      status: 'available',
    });
    setShowAddModal(false);
    setNewName('');
    setNewMake('');
    setNewModel('');
    setNewDailyRate('');
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [newName, newType, newCategory, newMake, newModel, newDailyRate, addEquipment]);

  if (!canAccess('equipment_rental') || !isProOrAbove) {
    return (
      <Paywall
        visible={true}
        feature="Equipment Tracking"
        requiredTier="pro"
        onClose={() => router.back()}
      />
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Text style={styles.largeTitle}>Equipment</Text>

      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{stats.total}</Text>
          <Text style={styles.statLabel}>Total Fleet</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={[styles.statValue, { color: Colors.info }]}>{stats.inUse}</Text>
          <Text style={styles.statLabel}>In Use</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={[styles.statValue, { color: stats.overdueCount > 0 ? Colors.error : Colors.success }]}>{stats.overdueCount}</Text>
          <Text style={styles.statLabel}>Overdue</Text>
        </View>
      </View>

      <View style={styles.filterRow}>
        {(['all', 'available', 'in_use', 'maintenance'] as FilterType[]).map(f => (
          <TouchableOpacity
            key={f}
            style={[styles.filterChip, filter === f && styles.filterChipActive]}
            onPress={() => setFilter(f)}
            activeOpacity={0.7}
          >
            <Text style={[styles.filterChipText, filter === f && styles.filterChipTextActive]}>
              {f === 'all' ? 'All' : f === 'in_use' ? 'In Use' : f.charAt(0).toUpperCase() + f.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView {...fabScroll} contentContainerStyle={{ paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE, paddingHorizontal: 16 }} showsVerticalScrollIndicator={false}>
        {filteredEquipment.length === 0 ? (
          // Empty state promoted from the hand-rolled icon-and-text block
          // to the shared premium EmptyState primitive (grid backdrop +
          // halo pulse + secondary action). Same component the Home tab
          // uses, so Equipment now reads as part of the same design
          // language instead of an orphan.
          <EmptyState
            icon={<MageEquipment size={40} color={themeColors.accent} />}
            title="Track your fleet"
            message="Owned + rented gear in one list. See daily rates, maintenance schedule, and which job each piece is on."
            actionLabel="Add equipment"
            onAction={() => setShowAddModal(true)}
          />
        ) : (
          filteredEquipment.map(equip => {
            const statusConfig = STATUS_CONFIG[equip.status] ?? STATUS_CONFIG.available;
            const hasOverdue = equip.maintenanceSchedule.some(m => m.isOverdue);
            const projectName = equip.currentProjectId ? getProject(equip.currentProjectId)?.name : null;

            return (
              <TouchableOpacity
                key={equip.id}
                style={styles.equipCard}
                onPress={() => router.push({ pathname: '/equipment-detail' as any, params: { equipmentId: equip.id } })}
                activeOpacity={0.7}
              >
                <View style={styles.equipCardHeader}>
                  <View style={styles.equipIconWrap}>
                    <MageEquipment size={20} color={Colors.primary} />
                  </View>
                  <View style={styles.equipCardInfo}>
                    <Text style={styles.equipName} numberOfLines={1}>{equip.name}</Text>
                    <Text style={styles.equipMeta}>{equip.make} {equip.model}</Text>
                  </View>
                  <View style={[styles.statusBadge, { backgroundColor: statusConfig.color + '20' }]}>
                    <Text style={[styles.statusBadgeText, { color: statusConfig.color }]}>{statusConfig.label}</Text>
                  </View>
                </View>
                <View style={styles.equipCardFooter}>
                  {projectName && (
                    <Text style={styles.equipProject} numberOfLines={1}>{projectName}</Text>
                  )}
                  <Text style={styles.equipRate}>{formatMoney(equip.dailyRate)}/day</Text>
                  {hasOverdue && (
                    <View style={styles.overdueBadge}>
                      <AlertTriangle size={12} color={Colors.error} strokeWidth={1.75} />
                      <Text style={styles.overdueText}>Overdue</Text>
                    </View>
                  )}
                </View>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>

      <TouchableOpacity
        style={[styles.fab, { bottom: insets.bottom + 20 }]}
        onPress={() => setShowAddModal(true)}
        activeOpacity={0.85}
        testID="add-equipment" accessibilityRole="button" accessibilityLabel="Add">
        <Plus size={24} color="#fff" strokeWidth={1.75} />
      </TouchableOpacity>

      <Modal visible={showAddModal} transparent animationType="slide" onRequestClose={() => setShowAddModal(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalCard, { paddingBottom: insets.bottom + 20 }]}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Add Equipment</Text>
                <TouchableOpacity onPress={() => setShowAddModal(false)} accessibilityRole="button" accessibilityLabel="Close">
                  <X size={22} color={Colors.textMuted} strokeWidth={1.75} />
                </TouchableOpacity>
              </View>

              <Text style={styles.fieldLabel}>Name *</Text>
              <TextInput
                style={styles.input}
                value={newName}
                onChangeText={setNewName}
                placeholder="e.g. Cat 320 Excavator"
                placeholderTextColor={Colors.textMuted}
              />

              <View style={styles.typeRow}>
                <TouchableOpacity
                  style={[styles.typeChip, newType === 'owned' && styles.typeChipActive]}
                  onPress={() => setNewType('owned')}
                >
                  <Text style={[styles.typeChipText, newType === 'owned' && styles.typeChipTextActive]}>Owned</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.typeChip, newType === 'rented' && styles.typeChipActive]}
                  onPress={() => setNewType('rented')}
                >
                  <Text style={[styles.typeChipText, newType === 'rented' && styles.typeChipTextActive]}>Rented</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.fieldLabel}>Category</Text>
              <TouchableOpacity style={styles.pickerBtn} onPress={() => setShowCategoryPicker(!showCategoryPicker)}>
                <Text style={styles.pickerBtnText}>
                  {EQUIPMENT_CATEGORIES.find(c => c.id === newCategory)?.label ?? 'Other'}
                </Text>
                <ChevronDown size={16} color={Colors.textMuted} strokeWidth={1.75} />
              </TouchableOpacity>
              {showCategoryPicker && (
                <View style={styles.categoryGrid}>
                  {EQUIPMENT_CATEGORIES.map(cat => (
                    <TouchableOpacity
                      key={cat.id}
                      style={[styles.catChip, newCategory === cat.id && styles.catChipActive]}
                      onPress={() => { setNewCategory(cat.id); setShowCategoryPicker(false); }}
                    >
                      <Text style={[styles.catChipText, newCategory === cat.id && styles.catChipTextActive]}>{cat.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              <View style={styles.rowFields}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>Make</Text>
                  <TextInput style={styles.input} value={newMake} onChangeText={setNewMake} placeholder="Caterpillar" placeholderTextColor={Colors.textMuted} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>Model</Text>
                  <TextInput style={styles.input} value={newModel} onChangeText={setNewModel} placeholder="320GC" placeholderTextColor={Colors.textMuted} />
                </View>
              </View>

              <Text style={styles.fieldLabel}>Daily Rate ($)</Text>
              <TextInput
                style={styles.input}
                value={newDailyRate}
                onChangeText={setNewDailyRate}
                placeholder="350"
                placeholderTextColor={Colors.textMuted}
                keyboardType="numeric"
              />

              <TouchableOpacity style={styles.saveBtn} onPress={handleAdd} activeOpacity={0.85}>
                <Text style={styles.saveBtnText}>Add Equipment</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

// Theme-aware. Pre-fix this was a module-level StyleSheet.create that
// baked Colors at load time → broken contrast in dark mode. Migrated
// to useThemedStyles + ThemeColors parameter.
const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: t.bg,
  },
  largeTitle: {
    fontSize: Type.largeTitle.fontSize,
    fontWeight: '700' as const,
    color: t.text,
    letterSpacing: -0.5,
    paddingHorizontal: 20,
    paddingTop: 4,
    marginBottom: 16,
  },
  statsRow: {
    flexDirection: 'row' as const,
    gap: 10,
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  statCard: {
    flex: 1,
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.lg,
    padding: 14,
    alignItems: 'center' as const,
    gap: 4,
  },
  statValue: {
    fontSize: 24,
    fontWeight: '800' as const,
    color: t.text,
  },
  statLabel: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '600' as const,
    color: t.textSecondary,
  },
  filterRow: {
    flexDirection: 'row' as const,
    gap: 8,
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: Tokens.radius.md,
    backgroundColor: Colors.fillTertiary,
  },
  filterChipActive: {
    backgroundColor: t.accentFill,
  },
  filterChipText: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '600' as const,
    color: t.textSecondary,
  },
  filterChipTextActive: {
    color: '#fff',
  },
  equipCard: {
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.panel,
    padding: 16,
    marginBottom: 10,
    gap: 10,
  },
  equipCardHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
  },
  equipIconWrap: {
    width: 40,
    height: 40,
    borderRadius: Tokens.radius.card,
    backgroundColor: t.accent + '12',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  equipCardInfo: {
    flex: 1,
    gap: 2,
  },
  equipName: {
    fontSize: Type.callout.fontSize,
    fontWeight: '600' as const,
    color: t.text,
  },
  equipMeta: {
    fontSize: Type.footnote.fontSize,
    color: t.textSecondary,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Tokens.radius.sm,
  },
  statusBadgeText: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '700' as const,
  },
  equipCardFooter: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
    paddingLeft: 52,
  },
  equipProject: {
    flex: 1,
    fontSize: Type.caption1.fontSize,
    color: t.textSecondary,
  },
  equipRate: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '600' as const,
    color: t.accent,
  },
  overdueBadge: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Tokens.radius.xs,
    backgroundColor: Colors.errorLight,
  },
  overdueText: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '600' as const,
    color: t.danger,
  },
  fab: {
    position: 'absolute' as const,
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: t.accent,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    shadowColor: t.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: 'flex-end' as const,
  },
  modalCard: {
    backgroundColor: t.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    maxHeight: '85%' as const,
  },
  modalHeader: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: Type.title3.fontSize,
    fontWeight: '700' as const,
    color: t.text,
  },
  fieldLabel: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '600' as const,
    color: t.textSecondary,
    marginBottom: 6,
    marginTop: 10,
  },
  input: {
    backgroundColor: t.surfaceAlt,
    borderRadius: Tokens.radius.card,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: Type.subhead.fontSize,
    color: t.text,
  },
  typeRow: {
    flexDirection: 'row' as const,
    gap: 10,
    marginTop: 10,
  },
  typeChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: Tokens.radius.md,
    backgroundColor: Colors.fillTertiary,
    alignItems: 'center' as const,
  },
  typeChipActive: {
    backgroundColor: t.accentFill,
  },
  typeChipText: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '600' as const,
    color: t.textSecondary,
  },
  typeChipTextActive: {
    color: '#fff',
  },
  pickerBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    backgroundColor: t.surfaceAlt,
    borderRadius: Tokens.radius.card,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  pickerBtnText: {
    fontSize: Type.subhead.fontSize,
    color: t.text,
  },
  categoryGrid: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 6,
    marginTop: 8,
  },
  catChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: Tokens.radius.sm,
    backgroundColor: Colors.fillTertiary,
  },
  catChipActive: {
    backgroundColor: t.accentFill,
  },
  catChipText: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '600' as const,
    color: t.textSecondary,
  },
  catChipTextActive: {
    color: '#fff',
  },
  rowFields: {
    flexDirection: 'row' as const,
    gap: 10,
  },
  saveBtn: {
    backgroundColor: t.accentFill,
    borderRadius: Tokens.radius.lg,
    paddingVertical: 16,
    alignItems: 'center' as const,
    marginTop: 20,
    shadowColor: t.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 4,
  },
  saveBtnText: {
    fontSize: Type.body.fontSize,
    fontWeight: '600' as const,
    color: '#fff',
  },
  lockedContainer: {
    flex: 1,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 40,
    gap: 16,
  },
  lockedIconWrap: {
    width: 80,
    height: 80,
    borderRadius: Tokens.radius['2xl'],
    backgroundColor: t.accent + '15',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginBottom: 8,
  },
  lockedTitle: {
    fontSize: 24,
    fontWeight: '700' as const,
    color: t.text,
  },
  lockedDesc: {
    fontSize: Type.subhead.fontSize,
    color: t.textSecondary,
    textAlign: 'center' as const,
    lineHeight: 22,
  },
  upgradeBtn: {
    backgroundColor: t.accentFill,
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: Tokens.radius.lg,
    marginTop: 8,
  },
  upgradeBtnText: {
    fontSize: Type.callout.fontSize,
    fontWeight: '700' as const,
    color: '#fff',
  },
});
