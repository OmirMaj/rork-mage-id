import React, { useState, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, Modal,
  TextInput, Alert, KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  Truck, Plus, AlertTriangle, X, ChevronDown, Crown,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import type { EquipmentCategory } from '@/types';
import { EQUIPMENT_CATEGORIES } from '@/types';
import { formatMoney } from '@/utils/formatters';

type FilterType = 'all' | 'available' | 'in_use' | 'maintenance';

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  available: { label: 'Available', color: Colors.success },
  in_use: { label: 'In Use', color: Colors.info },
  maintenance: { label: 'Maintenance', color: Colors.warning },
  retired: { label: 'Retired', color: Colors.textMuted },
};

export default function EquipmentScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { equipment, addEquipment, getProject } = useProjects();
  const { isProOrAbove } = useSubscription();

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
      (e.maintenanceSchedule ?? []).some(m => m.isOverdue)
    ).length,
  }), [equipment]);

  const filteredEquipment = useMemo(() => {
    if (filter === 'all') return equipment;
    return equipment.filter(e => e.status === filter);
  }, [equipment, filter]);

  const handleAdd = useCallback(() => {
    if (!newName.trim()) {
      Alert.alert('Missing Name', 'Please enter an equipment name.');
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

  if (!isProOrAbove) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.lockedContainer}>
          <View style={styles.lockedIconWrap}>
            <Crown size={40} color={Colors.accent} />
          </View>
          <Text style={styles.lockedTitle}>Equipment Tracking</Text>
          <Text style={styles.lockedDesc}>
            Track your fleet, schedule maintenance, and log daily utilization. Upgrade to Pro to unlock.
          </Text>
          <TouchableOpacity
            style={styles.upgradeBtn}
            onPress={() => router.push('/paywall')}
            activeOpacity={0.85}
          >
            <Text style={styles.upgradeBtnText}>Upgrade to Pro</Text>
          </TouchableOpacity>
        </View>
      </View>
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

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 100, paddingHorizontal: 16 }} showsVerticalScrollIndicator={false}>
        {filteredEquipment.length === 0 ? (
          <View style={styles.emptyState}>
            <Truck size={48} color={Colors.textMuted} />
            <Text style={styles.emptyTitle}>No Equipment</Text>
            <Text style={styles.emptyDesc}>Add your first piece of equipment to start tracking.</Text>
          </View>
        ) : (
          filteredEquipment.map(equip => {
            const statusConfig = STATUS_CONFIG[equip.status] ?? STATUS_CONFIG.available;
            const hasOverdue = (equip.maintenanceSchedule ?? []).some(m => m.isOverdue);
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
                    <Truck size={20} color={Colors.primary} />
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
                      <AlertTriangle size={12} color={Colors.error} />
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
        testID="add-equipment"
      >
        <Plus size={24} color="#fff" />
      </TouchableOpacity>

      <Modal visible={showAddModal} transparent animationType="slide" onRequestClose={() => setShowAddModal(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalCard, { paddingBottom: insets.bottom + 20 }]}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Add Equipment</Text>
                <TouchableOpacity onPress={() => setShowAddModal(false)}>
                  <X size={22} color={Colors.textMuted} />
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
                <ChevronDown size={16} color={Colors.textMuted} />
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  largeTitle: {
    fontSize: 34,
    fontWeight: '700' as const,
    color: Colors.text,
    letterSpacing: -0.5,
    paddingHorizontal: 20,
    paddingTop: 4,
    marginBottom: 16,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  statCard: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
    gap: 4,
  },
  statValue: {
    fontSize: 24,
    fontWeight: '800' as const,
    color: Colors.text,
  },
  statLabel: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },
  filterRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: Colors.fillTertiary,
  },
  filterChipActive: {
    backgroundColor: Colors.primary,
  },
  filterChipText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },
  filterChipTextActive: {
    color: '#fff',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 60,
    gap: 10,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  emptyDesc: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  equipCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 10,
    gap: 10,
  },
  equipCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  equipIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: Colors.primary + '12',
    alignItems: 'center',
    justifyContent: 'center',
  },
  equipCardInfo: {
    flex: 1,
    gap: 2,
  },
  equipName: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  equipMeta: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '700' as const,
  },
  equipCardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: 52,
  },
  equipProject: {
    flex: 1,
    fontSize: 12,
    color: Colors.textSecondary,
  },
  equipRate: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.primary,
  },
  overdueBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: Colors.errorLight,
  },
  overdueText: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: Colors.error,
  },
  fab: {
    position: 'absolute',
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
    marginBottom: 6,
    marginTop: 10,
  },
  input: {
    backgroundColor: Colors.surfaceAlt,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: Colors.text,
  },
  typeRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
  },
  typeChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: Colors.fillTertiary,
    alignItems: 'center',
  },
  typeChipActive: {
    backgroundColor: Colors.primary,
  },
  typeChipText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },
  typeChipTextActive: {
    color: '#fff',
  },
  pickerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.surfaceAlt,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  pickerBtnText: {
    fontSize: 15,
    color: Colors.text,
  },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  catChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: Colors.fillTertiary,
  },
  catChipActive: {
    backgroundColor: Colors.primary,
  },
  catChipText: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },
  catChipTextActive: {
    color: '#fff',
  },
  rowFields: {
    flexDirection: 'row',
    gap: 10,
  },
  saveBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 20,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 4,
  },
  saveBtnText: {
    fontSize: 17,
    fontWeight: '600' as const,
    color: '#fff',
  },
  lockedContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
    gap: 16,
  },
  lockedIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 24,
    backgroundColor: Colors.accent + '15',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  lockedTitle: {
    fontSize: 24,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  lockedDesc: {
    fontSize: 15,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  upgradeBtn: {
    backgroundColor: Colors.accent,
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 14,
    marginTop: 8,
  },
  upgradeBtnText: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: '#fff',
  },
});

