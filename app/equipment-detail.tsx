import React, { useState, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Platform, Modal, KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  Truck, Wrench, Clock, Trash2, X, AlertTriangle,
  Save, ChevronDown,
} from 'lucide-react-native';
import Svg, { Rect } from 'react-native-svg';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useProjects } from '@/contexts/ProjectContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import AIEquipmentAdvice from '@/components/AIEquipmentAdvice';
import type { EquipmentCategory } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { showAlert } from '@/utils/alert';

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  available: { label: 'Available', color: "#2E7D44" },
  in_use: { label: 'In Use', color: "#1565C0" },
  maintenance: { label: 'Maintenance', color: Colors.warning },
  retired: { label: 'Retired', color: "#9AA3AD" },
};

export default function EquipmentDetailScreen() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
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
      showAlert('Missing Name', 'Please enter an equipment name.');
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
    showAlert('Saved', 'Equipment updated successfully.');
  }, [equip, editName, editMake, editModel, editDailyRate, editStatus, editCategory, editSerialNumber, editNotes, editProjectId, updateEquipment]);

  const handleDelete = useCallback(() => {
    if (!equip) return;
    showAlert('Delete Equipment', `Delete ${equip.name}? This cannot be undone.`, [
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
      showAlert('Invalid Hours', 'Please enter valid hours.');
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
        headerStyle: { backgroundColor: themeColors.bg },
        headerTintColor: "#FF6A1A",
        headerTitleStyle: { fontWeight: '700' as const, color: themeColors.text },
      }} />
      <ScrollView
        {...fabScroll}
        style={styles.container}
        contentContainerStyle={{ paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE, padding: 16 }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.headerCard}>
          <View style={styles.equipIconWrap}>
            <Truck size={28} color={"#FF6A1A"} strokeWidth={1.75} />
          </View>
          <View style={[styles.statusBadge, { backgroundColor: statusConfig.color + '20' }]}>
            <Text style={[styles.statusBadgeText, { color: statusConfig.color }]}>{statusConfig.label}</Text>
          </View>
          <Text style={styles.rateText}>${equip.dailyRate}/day</Text>
        </View>

        <Text style={styles.fieldLabel}>Name *</Text>
        <TextInput style={styles.input} value={editName} onChangeText={setEditName} placeholder="Equipment name" placeholderTextColor={"#9AA3AD"} />

        <View style={styles.rowFields}>
          <View style={{ flex: 1 }}>
            <Text style={styles.fieldLabel}>Make</Text>
            <TextInput style={styles.input} value={editMake} onChangeText={setEditMake} placeholder="Make" placeholderTextColor={"#9AA3AD"} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.fieldLabel}>Model</Text>
            <TextInput style={styles.input} value={editModel} onChangeText={setEditModel} placeholder="Model" placeholderTextColor={"#9AA3AD"} />
          </View>
        </View>

        <Text style={styles.fieldLabel}>Serial Number</Text>
        <TextInput style={styles.input} value={editSerialNumber} onChangeText={setEditSerialNumber} placeholder="Optional" placeholderTextColor={"#9AA3AD"} />

        <Text style={styles.fieldLabel}>Daily Rate ($)</Text>
        <TextInput style={styles.input} value={editDailyRate} onChangeText={setEditDailyRate} placeholder="350" placeholderTextColor={"#9AA3AD"} keyboardType="numeric" />

        <Text style={styles.fieldLabel}>Status</Text>
        <TouchableOpacity style={styles.pickerBtn} onPress={() => setShowStatusPicker(!showStatusPicker)}>
          <View style={[styles.statusDot, { backgroundColor: (STATUS_CONFIG[editStatus] ?? STATUS_CONFIG.available).color }]} />
          <Text style={styles.pickerBtnText}>{(STATUS_CONFIG[editStatus] ?? STATUS_CONFIG.available).label}</Text>
          <ChevronDown size={16} color={"#9AA3AD"} strokeWidth={1.75} />
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
          <ChevronDown size={16} color={"#9AA3AD"} strokeWidth={1.75} />
        </TouchableOpacity>
        {showProjectPicker && (
          <View style={styles.projectList}>
            <TouchableOpacity style={styles.projectItem} onPress={() => { setEditProjectId(''); setShowProjectPicker(false); }}>
              <Text style={styles.projectItemText}>None</Text>
            </TouchableOpacity>
            {projects.map(p => (
              <TouchableOpacity key={p.id} style={styles.projectItem} onPress={() => { setEditProjectId(p.id); setShowProjectPicker(false); }}>
                <Text style={[styles.projectItemText, editProjectId === p.id && { color: "#FF6A1A", fontWeight: '600' as const }]}>{p.name}</Text>
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
          placeholderTextColor={"#9AA3AD"}
          multiline
          textAlignVertical="top"
        />

        <Text style={styles.sectionTitle}>Maintenance Schedule</Text>
        {equip.maintenanceSchedule.length === 0 ? (
          <Text style={styles.noDataText}>No maintenance items scheduled.</Text>
        ) : (
          equip.maintenanceSchedule.map((item) => (
            <View key={item.id} style={[styles.maintCard, item.isOverdue && styles.maintCardOverdue]}>
              <View style={styles.maintHeader}>
                <Wrench size={14} color={item.isOverdue ? "#C84038" : "#9AA3AD"} strokeWidth={1.75} />
                <Text style={styles.maintDesc}>{item.description}</Text>
                {item.isOverdue && <AlertTriangle size={14} color={"#C84038"} strokeWidth={1.75} />}
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
                    fill={"#FF6A1A"}
                    opacity={0.8}
                  />
                );
              })}
            </Svg>
          </View>
        )}

        <TouchableOpacity style={styles.logBtn} onPress={() => setShowLogModal(true)} activeOpacity={0.7}>
          <Clock size={16} color={"#FF6A1A"} strokeWidth={1.75} />
          <Text style={styles.logBtnText}>Log Today's Use</Text>
        </TouchableOpacity>

        {equip && (
          <AIEquipmentAdvice
            equipment={equip}
            subscriptionTier={tier as any}
          />
        )}

        <TouchableOpacity style={styles.saveBtn} onPress={handleSave} activeOpacity={0.85} testID="save-equipment">
          <Save size={18} color="#fff" strokeWidth={1.75} />
          <Text style={styles.saveBtnText}>Save Changes</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete} activeOpacity={0.7}>
          <Trash2 size={16} color={"#C84038"} strokeWidth={1.75} />
          <Text style={styles.deleteBtnText}>Delete Equipment</Text>
        </TouchableOpacity>
      </ScrollView>

      <Modal visible={showLogModal} transparent animationType="fade" onRequestClose={() => setShowLogModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Log Usage</Text>
              <TouchableOpacity onPress={() => setShowLogModal(false)} accessibilityRole="button" accessibilityLabel="Close">
                <X size={20} color={"#9AA3AD"} strokeWidth={1.75} />
              </TouchableOpacity>
            </View>
            <Text style={styles.fieldLabel}>Hours Used</Text>
            <TextInput style={styles.input} value={logHours} onChangeText={setLogHours} keyboardType="numeric" placeholder="8" placeholderTextColor={"#9AA3AD"} />
            <Text style={styles.fieldLabel}>Operator Name</Text>
            <TextInput style={styles.input} value={logOperator} onChangeText={setLogOperator} placeholder="Optional" placeholderTextColor={"#9AA3AD"} />
            <TouchableOpacity style={styles.saveBtn} onPress={handleLogUse} activeOpacity={0.85}>
              <Text style={styles.saveBtnText}>Log Usage</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: t.bg,
  },
  center: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    fontSize: Type.callout.fontSize,
    color: t.textSecondary,
  },
  headerCard: {
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.panel,
    padding: 20,
    alignItems: 'center',
    gap: 10,
    marginBottom: 20,
  },
  equipIconWrap: {
    width: 56,
    height: 56,
    borderRadius: Tokens.radius.panel,
    backgroundColor: t.accent + '12',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: Tokens.radius.sm,
  },
  statusBadgeText: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '700' as const,
  },
  rateText: {
    fontSize: Type.subheadline.fontSize,
    fontWeight: '700' as const,
    color: t.accent,
  },
  fieldLabel: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '600' as const,
    color: t.textSecondary,
    marginBottom: 6,
    marginTop: 12,
  },
  input: {
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.card,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: Type.subhead.fontSize,
    color: t.text,
    borderWidth: 1,
    borderColor: t.line,
  },
  rowFields: {
    flexDirection: 'row',
    gap: 10,
  },
  pickerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.card,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: t.line,
  },
  pickerBtnText: {
    flex: 1,
    fontSize: Type.subhead.fontSize,
    color: t.text,
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
    borderRadius: Tokens.radius.sm,
    backgroundColor: t.surfaceAlt,
  },
  optionChipText: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '600' as const,
    color: t.textSecondary,
  },
  projectList: {
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.card,
    marginTop: 6,
    overflow: 'hidden',
    maxHeight: 200,
  },
  projectItem: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: t.line,
  },
  projectItemText: {
    fontSize: Type.bodyCompact.fontSize,
    color: t.text,
  },
  sectionTitle: {
    fontSize: Type.subheadline.fontSize,
    fontWeight: '700' as const,
    color: t.text,
    marginTop: 24,
    marginBottom: 12,
  },
  noDataText: {
    fontSize: Type.bodyCompact.fontSize,
    color: t.textMuted,
    fontStyle: 'italic',
  },
  maintCard: {
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.card,
    padding: 14,
    marginBottom: 8,
    gap: 4,
  },
  maintCardOverdue: {
    borderLeftWidth: 3,
    borderLeftColor: t.danger,
  },
  maintHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  maintDesc: {
    flex: 1,
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '600' as const,
    color: t.text,
  },
  maintDetail: {
    fontSize: Type.caption1.fontSize,
    color: t.textSecondary,
    paddingLeft: 22,
  },
  chartCard: {
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.card,
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
    borderRadius: Tokens.radius.card,
    backgroundColor: t.accent + '12',
    marginTop: 8,
  },
  logBtnText: {
    fontSize: Type.subhead.fontSize,
    fontWeight: '600' as const,
    color: t.accent,
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: t.accentFill,
    borderRadius: Tokens.radius.lg,
    paddingVertical: 16,
    marginTop: 24,
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
  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    marginTop: 12,
  },
  deleteBtnText: {
    fontSize: Type.subhead.fontSize,
    fontWeight: '600' as const,
    color: t.danger,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    backgroundColor: t.surface,
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
    fontSize: Type.title3.fontSize,
    fontWeight: '700' as const,
    color: t.text,
  },
});
