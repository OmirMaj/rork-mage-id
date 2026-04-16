import React, { useState, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  Alert, Platform, Modal, KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  Truck, Wrench, Clock, Trash2, X, AlertTriangle,
  Save, ChevronDown,
} from 'lucide-react-native';
import Svg, { Rect } from 'react-native-svg';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import AIEquipmentAdvice from '@/components/AIEquipmentAdvice';
import type { EquipmentCategory } from '@/types';

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  available: { label: 'Available', color: Colors.success },
  in_use: { label: 'In Use', color: Colors.info },
  maintenance: { label: 'Maintenance', color: Colors.warning },
  retired: { label: 'Retired', color: Colors.textMuted },
};

export default function EquipmentDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { equipmentId } = useLocalSearchParams<{ equipmentId: string }>();
  const { equipment, updateEquipment, deleteEquipment, logUtilization, projects } = useProjects();
  const { tier } = useSubscription();

  const equip = useMemo(() => equipment.find(e => e.id === equipmentId) ?? null, [equipment, equipmentId]);

  const [editName, setEditName] = useState(equip?.name ?? '');
  const [editMake, setEditMake] = useState(equip?.make ?? '');
  const [editModel, setEditModel] = useState(equip?.model ?? '');
  const [editDailyRate, setEditDailyRate] = useState(equip?.dailyRate?.toString() ?? '');
  const [editStatus, setEditStatus] = useState(equip?.status ?? 'available');
  const [editCategory, _setEditCategory] = useState<EquipmentCategory>(equip?.category ?? 'other');
  const [editSerialNumber, setEditSerialNumber] = useState(equip?.serialNumber ?? '');
  const [editNotes, setEditNotes] = useState(equip?.notes ?? '');
  const [editProjectId, setEditProjectId] = useState(equip?.currentProjectId ?? '');
  const [showStatusPicker, setShowStatusPicker] = useState(false);
  const [showLogModal, setShowLogModal] = useState(false);
  const [logHours, setLogHours] = useState('8');
  const [logOperator, setLogOperator] = useState('');
  const [showProjectPicker, setShowProjectPicker] = useState(false);

  const last30Days = useMemo(() => {
    if (!equip) return [];
    const now = Date.now();
    const thirtyDaysAgo = now - 30 * 86400000;
    return equip.utilizationLog
      .filter(u => new Date(u.date).getTime() >= thirtyDaysAgo)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [equip]);

  const maxHours = useMemo(() => Math.max(...last30Days.map(u => u.hoursUsed), 1), [last30Days]);

  const handleSave = useCallback(() => {
    if (!equip || !editName.trim()) {
      Alert.alert('Missing Name', 'Please enter an equipment name.');
      return;
    }
    updateEquipment(equip.id, {
      name: editName.trim(),
      make: editMake.trim(),
      model: editModel.trim(),
      dailyRate: parseFloat(editDailyRate) || 0,
      status: editStatus,
      category: editCategory,
      serialNumber: editSerialNumber.trim() || undefined,
      notes: editNotes.trim() || undefined,
      currentProjectId: editProjectId || undefined,
    });
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert('Saved', 'Equipment updated successfully.');
  }, [equip, editName, editMake, editModel, editDailyRate, editStatus, editCategory, editSerialNumber, editNotes, editProjectId, updateEquipment]);

  const handleDelete = useCallback(() => {
    if (!equip) return;
    Alert.alert('Delete Equipment', `Delete ${equip.name}? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: () => {
          deleteEquipment(equip.id);
          router.back();
        },
      },
    ]);
  }, [equip, deleteEquipment, router]);

  const handleLogUse = useCallback(() => {
    if (!equip) return;
    const hours = parseFloat(logHours) || 0;
    if (hours <= 0) {
      Alert.alert('Invalid Hours', 'Please enter valid hours.');
      return;
    }
    logUtilization({
      equipmentId: equip.id,
      projectId: editProjectId || '',
      date: new Date().toISOString(),
      hoursUsed: hours,
      operatorName: logOperator.trim() || undefined,
    });
    setShowLogModal(false);
    setLogHours('8');
    setLogOperator('');
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [equip, logHours, logOperator, editProjectId, logUtilization]);

  if (!equip) {
    return (
      <View style={[styles.container, styles.center]}>
        <Stack.Screen options={{ title: 'Not Found' }} />
        <Text style={styles.emptyText}>Equipment not found</Text>
      </View>
    );
  }

  const statusConfig = STATUS_CONFIG[equip.status] ?? STATUS_CONFIG.available;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <Stack.Screen options={{
        title: equip.name,
        headerStyle: { backgroundColor: Colors.background },
        headerTintColor: Colors.primary,
        headerTitleStyle: { fontWeight: '700' as const, color: Colors.text },
      }} />
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ paddingBottom: insets.bottom + 100, padding: 16 }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.headerCard}>
          <View style={styles.equipIconWrap}>
            <Truck size={28} color={Colors.primary} />
          </View>
          <View style={[styles.statusBadge, { backgroundColor: statusConfig.color + '20' }]}>
            <Text style={[styles.statusBadgeText, { color: statusConfig.color }]}>{statusConfig.label}</Text>
          </View>
          <Text style={styles.rateText}>${equip.dailyRate}/day</Text>
        </View>

        <Text style={styles.fieldLabel}>Name *</Text>
        <TextInput style={styles.input} value={editName} onChangeText={setEditName} placeholder="Equipment name" placeholderTextColor={Colors.textMuted} />

        <View style={styles.rowFields}>
          <View style={{ flex: 1 }}>
            <Text style={styles.fieldLabel}>Make</Text>
            <TextInput style={styles.input} value={editMake} onChangeText={setEditMake} placeholder="Make" placeholderTextColor={Colors.textMuted} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.fieldLabel}>Model</Text>
            <TextInput style={styles.input} value={editModel} onChangeText={setEditModel} placeholder="Model" placeholderTextColor={Colors.textMuted} />
          </View>
        </View>

        <Text style={styles.fieldLabel}>Serial Number</Text>
        <TextInput style={styles.input} value={editSerialNumber} onChangeText={setEditSerialNumber} placeholder="Optional" placeholderTextColor={Colors.textMuted} />

        <Text style={styles.fieldLabel}>Daily Rate ($)</Text>
        <TextInput style={styles.input} value={editDailyRate} onChangeText={setEditDailyRate} placeholder="350" placeholderTextColor={Colors.textMuted} keyboardType="numeric" />

        <Text style={styles.fieldLabel}>Status</Text>
        <TouchableOpacity style={styles.pickerBtn} onPress={() => setShowStatusPicker(!showStatusPicker)}>
          <View style={[styles.statusDot, { backgroundColor: (STATUS_CONFIG[editStatus] ?? STATUS_CONFIG.available).color }]} />
          <Text style={styles.pickerBtnText}>{(STATUS_CONFIG[editStatus] ?? STATUS_CONFIG.available).label}</Text>
          <ChevronDown size={16} color={Colors.textMuted} />
        </TouchableOpacity>
        {showStatusPicker && (
          <View style={styles.optionsRow}>
            {Object.entries(STATUS_CONFIG).map(([key, val]) => (
              <TouchableOpacity
                key={key}
                style={[styles.optionChip, editStatus === key && { backgroundColor: val.color }]}
                onPress={() => { setEditStatus(key as any); setShowStatusPicker(false); }}
              >
                <Text style={[styles.optionChipText, editStatus === key && { color: '#fff' }]}>{val.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        <Text style={styles.fieldLabel}>Assigned Project</Text>
        <TouchableOpacity style={styles.pickerBtn} onPress={() => setShowProjectPicker(!showProjectPicker)}>
          <Text style={styles.pickerBtnText}>
            {editProjectId ? (projects.find(p => p.id === editProjectId)?.name ?? 'Unknown') : 'None'}
          </Text>
          <ChevronDown size={16} color={Colors.textMuted} />
        </TouchableOpacity>
        {showProjectPicker && (
          <View style={styles.projectList}>
            <TouchableOpacity style={styles.projectItem} onPress={() => { setEditProjectId(''); setShowProjectPicker(false); }}>
              <Text style={styles.projectItemText}>None</Text>
            </TouchableOpacity>
            {projects.map(p => (
              <TouchableOpacity key={p.id} style={styles.projectItem} onPress={() => { setEditProjectId(p.id); setShowProjectPicker(false); }}>
                <Text style={[styles.projectItemText, editProjectId === p.id && { color: Colors.primary, fontWeight: '600' as const }]}>{p.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        <Text style={styles.fieldLabel}>Notes</Text>
        <TextInput
          style={[styles.input, { minHeight: 70, paddingTop: 12 }]}
          value={editNotes}
          onChangeText={setEditNotes}
          placeholder="Notes..."
          placeholderTextColor={Colors.textMuted}
          multiline
          textAlignVertical="top"
        />

        <Text style={styles.sectionTitle}>Maintenance Schedule</Text>
        {(equip.maintenanceSchedule ?? []).length === 0 ? (
          <Text style={styles.noDataText}>No maintenance items scheduled.</Text>
        ) : (
          (equip.maintenanceSchedule ?? []).map((item) => (
            <View key={item.id} style={[styles.maintCard, item.isOverdue && styles.maintCardOverdue]}>
              <View style={styles.maintHeader}>
                <Wrench size={14} color={item.isOverdue ? Colors.error : Colors.textSecondary} />
                <Text style={styles.maintDesc}>{item.description}</Text>
                {item.isOverdue && <AlertTriangle size={14} color={Colors.error} />}
              </View>
              <Text style={styles.maintDetail}>
                Every {item.intervalDays} days | Next: {new Date(item.nextDue).toLocaleDateString()}
              </Text>
            </View>
          ))
        )}

        <Text style={styles.sectionTitle}>Utilization (Last 30 Days)</Text>
        {last30Days.length === 0 ? (
          <Text style={styles.noDataText}>No utilization logged yet.</Text>
        ) : (
          <View style={styles.chartCard}>
            <Svg width={last30Days.length * 20 + 20} height={100}>
              {last30Days.map((entry, i) => {
                const barHeight = (entry.hoursUsed / maxHours) * 70;
                return (
                  <Rect
                    key={entry.id}
                    x={i * 20 + 10}
                    y={90 - barHeight}
                    width={14}
                    height={barHeight}
                    rx={4}
                    fill={Colors.primary}
                    opacity={0.8}
                  />
                );
              })}
            </Svg>
          </View>
        )}

        <TouchableOpacity style={styles.logBtn} onPress={() => setShowLogModal(true)} activeOpacity={0.7}>
          <Clock size={16} color={Colors.primary} />
          <Text style={styles.logBtnText}>Log Today's Use</Text>
        </TouchableOpacity>

        {equip && (
          <AIEquipmentAdvice
            equipment={equip}
            subscriptionTier={tier as any}
          />
        )}

        <TouchableOpacity style={styles.saveBtn} onPress={handleSave} activeOpacity={0.85} testID="save-equipment">
          <Save size={18} color="#fff" />
          <Text style={styles.saveBtnText}>Save Changes</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete} activeOpacity={0.7}>
          <Trash2 size={16} color={Colors.error} />
          <Text style={styles.deleteBtnText}>Delete Equipment</Text>
        </TouchableOpacity>
      </ScrollView>

      <Modal visible={showLogModal} transparent animationType="fade" onRequestClose={() => setShowLogModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Log Usage</Text>
              <TouchableOpacity onPress={() => setShowLogModal(false)}>
                <X size={20} color={Colors.textMuted} />
              </TouchableOpacity>
            </View>
            <Text style={styles.fieldLabel}>Hours Used</Text>
            <TextInput style={styles.input} value={logHours} onChangeText={setLogHours} keyboardType="numeric" placeholder="8" placeholderTextColor={Colors.textMuted} />
            <Text style={styles.fieldLabel}>Operator Name</Text>
            <TextInput style={styles.input} value={logOperator} onChangeText={setLogOperator} placeholder="Optional" placeholderTextColor={Colors.textMuted} />
            <TouchableOpacity style={styles.saveBtn} onPress={handleLogUse} activeOpacity={0.85}>
              <Text style={styles.saveBtnText}>Log Usage</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  center: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 16,
    color: Colors.textSecondary,
  },
  headerCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    gap: 10,
    marginBottom: 20,
  },
  equipIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: Colors.primary + '12',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 8,
  },
  statusBadgeText: {
    fontSize: 13,
    fontWeight: '700' as const,
  },
  rateText: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.primary,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
    marginBottom: 6,
    marginTop: 12,
  },
  input: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  rowFields: {
    flexDirection: 'row',
    gap: 10,
  },
  pickerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  pickerBtnText: {
    flex: 1,
    fontSize: 15,
    color: Colors.text,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  optionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  optionChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: Colors.fillTertiary,
  },
  optionChipText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },
  projectList: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    marginTop: 6,
    overflow: 'hidden',
    maxHeight: 200,
  },
  projectItem: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.borderLight,
  },
  projectItemText: {
    fontSize: 14,
    color: Colors.text,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.text,
    marginTop: 24,
    marginBottom: 12,
  },
  noDataText: {
    fontSize: 14,
    color: Colors.textMuted,
    fontStyle: 'italic',
  },
  maintCard: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    gap: 4,
  },
  maintCardOverdue: {
    borderLeftWidth: 3,
    borderLeftColor: Colors.error,
  },
  maintHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  maintDesc: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  maintDetail: {
    fontSize: 12,
    color: Colors.textSecondary,
    paddingLeft: 22,
  },
  chartCard: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    overflow: 'hidden',
  },
  logBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: Colors.primary + '12',
    marginTop: 8,
  },
  logBtnText: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.primary,
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 16,
    marginTop: 24,
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
  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    marginTop: 12,
  },
  deleteBtnText: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.error,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    gap: 4,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700' as const,
    color: Colors.text,
  },
});

