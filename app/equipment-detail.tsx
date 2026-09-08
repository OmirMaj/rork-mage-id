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
import { EQUIPMENT_HOURS_PER_DAY } from '@/utils/jobCostEngine';
import { cardSurface, labelOn, neutralInk } from '@/components/ui';
import { NATIVE_HEADER_TITLE_FACE } from '@/constants/navigation';

// A factory, not a frozen object. `retired` was the DARK theme's textSecondary
// (#9AA3AD) hardcoded here, which rendered at 2.55:1 as the badge label on a
// light screen — and `Colors.warningLabel` beside it is a getter, so it froze
// to whatever theme happened to be active at import. Both are read per render
// now. Each colour is used three ways on this screen (a dot, a label on its own
// `+ '20'` tint, and a chip fill under a label), so all three have to clear AA;
// `labelOn` picks the chip's label rather than assuming white.
function statusConfig(t: ThemeColors): Record<string, { label: string; color: string }> {
  return {
    available: { label: 'Available', color: t.success },
    in_use: { label: 'In Use', color: t.info },
    maintenance: { label: 'Maintenance', color: t.warningLabel },
    retired: { label: 'Retired', color: neutralInk(t) },
  };
}

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

  // The job these hours will be charged to, RESOLVED — not just a non-empty id.
  //
  // utils/jobCostEngine.ts matches utilization rows with
  // `u.projectId === project.id`, so an entry carrying '' — or an id whose
  // project has since been deleted — never lands on any job. This screen used
  // to log `editProjectId || ''`, so a shift entered with the Assigned Project
  // picker on "None" wrote real machine time that no actual-cost figure could
  // ever see: the excavator ran, the money left, and every phase sheet, CPI and
  // WIP row read as if it hadn't. That is the exact omission MONEY-EQP-1 was
  // written to close, re-opened one screen upstream.
  //
  // Requiring a project rather than filing the hours under "unassigned": the
  // Assigned Project picker is on this same screen and already writes the id
  // this needs, so the requirement is satisfiable without leaving — an
  // unassigned bucket would just be a new place for money to sit unread, which
  // is what we already had. The picker is NOT adjacent to the log button
  // though: Notes, the maintenance list and the 30-day chart sit between them,
  // so on a phone it is off-screen, which is why the blocked copy says where to
  // go rather than assuming the GC can see it.
  const logProject = useMemo(
    () => (editProjectId ? projects.find(p => p.id === editProjectId) ?? null : null),
    [editProjectId, projects],
  );
  const logBlockedReason = logProject
    ? null
    : editProjectId
      ? 'That project no longer exists. Scroll up to Assigned Project and pick another — hours logged against a deleted job never reach any cost report.'
      : 'Scroll up to Assigned Project and pick a job first. Equipment hours are charged to that job at this machine’s day rate, and hours with no job never reach its cost.';

  // What this write will actually cost the job, in the job's own terms and
  // with the engine's own arithmetic — hours ÷ EQUIPMENT_HOURS_PER_DAY × day
  // rate, with the divisor IMPORTED from utils/jobCostEngine.ts rather than
  // spelled "8" here. A screen that hardcodes the engine's definition goes on
  // promising a number the engine has stopped producing, and the GC has no way
  // to tell which of the two is lying.
  //
  // A machine with no day rate is called out instead of quietly previewing $0:
  // the engine refuses to invent a rate (`if (rate <= 0) continue`), so those
  // hours really do land on the job as nothing, and that is worth learning here
  // rather than from a phase sheet that stayed flat after a week of digging.
  const chargePreview = useMemo(() => {
    if (!logProject || !equip) return null;
    const rate = Number.isFinite(equip.dailyRate) ? equip.dailyRate : 0;
    if (rate <= 0) {
      return `Logged against ${logProject.name}. This machine has no daily rate, so these hours carry no cost on that job until you set one.`;
    }
    const hours = Math.max(0, parseFloat(logHours) || 0);
    const cost = (hours / EQUIPMENT_HOURS_PER_DAY) * rate;
    const money = cost.toLocaleString(undefined, { maximumFractionDigits: 2 });
    return `Charged to ${logProject.name} at $${rate.toLocaleString()}/day — ${EQUIPMENT_HOURS_PER_DAY} hours is one day, so ${hours} h adds $${money} to that job's cost.`;
  }, [logProject, equip, logHours]);

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
    // The button that opens this modal is disabled and says why, so this is the
    // last gate rather than the first — but it is a money write, and the cost of
    // being wrong is hours that exist on the machine and nowhere in the books.
    if (!logProject) {
      showAlert('No job selected', 'Assign this machine to a project before logging hours, or the time is charged to nothing.');
      return;
    }
    logUtilization({
      equipmentId: equip.id,
      projectId: logProject.id,
      date: new Date().toISOString(),
      hoursUsed: hours,
      operatorName: logOperator.trim() || undefined,
    });
    setShowLogModal(false);
    setLogHours('8');
    setLogOperator('');
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [equip, logHours, logOperator, logProject, logUtilization]);

  if (!equip) {
    return (
      <View style={[styles.container, styles.center]}>
        <Stack.Screen options={{ title: 'Not Found' }} />
        <Text style={styles.emptyText}>Equipment not found</Text>
      </View>
    );
  }

  const STATUS = statusConfig(themeColors);
  const status = STATUS[equip.status] ?? STATUS.available;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <Stack.Screen options={{
        title: equip.name,
        headerStyle: { backgroundColor: themeColors.bg },
        headerTintColor: "#FF6A1A",
        headerTitleStyle: { ...NATIVE_HEADER_TITLE_FACE, color: themeColors.text },
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
          <View style={[styles.statusBadge, { backgroundColor: status.color + '20' }]}>
            <Text style={[styles.statusBadgeText, { color: status.color }]}>{status.label}</Text>
          </View>
          <Text style={styles.rateText}>${equip.dailyRate}/day</Text>
        </View>

        <Text style={styles.fieldLabel}>Name *</Text>
        <TextInput style={styles.input} value={editName} onChangeText={setEditName} placeholder="Equipment name" placeholderTextColor={themeColors.textMuted} />

        <View style={styles.rowFields}>
          <View style={{ flex: 1 }}>
            <Text style={styles.fieldLabel}>Make</Text>
            <TextInput style={styles.input} value={editMake} onChangeText={setEditMake} placeholder="Make" placeholderTextColor={themeColors.textMuted} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.fieldLabel}>Model</Text>
            <TextInput style={styles.input} value={editModel} onChangeText={setEditModel} placeholder="Model" placeholderTextColor={themeColors.textMuted} />
          </View>
        </View>

        <Text style={styles.fieldLabel}>Serial Number</Text>
        <TextInput style={styles.input} value={editSerialNumber} onChangeText={setEditSerialNumber} placeholder="Optional" placeholderTextColor={themeColors.textMuted} />

        <Text style={styles.fieldLabel}>Daily Rate ($)</Text>
        <TextInput style={styles.input} value={editDailyRate} onChangeText={setEditDailyRate} placeholder="350" placeholderTextColor={themeColors.textMuted} keyboardType="numeric" />

        <Text style={styles.fieldLabel}>Status</Text>
        <TouchableOpacity style={styles.pickerBtn} onPress={() => setShowStatusPicker(!showStatusPicker)}>
          <View style={[styles.statusDot, { backgroundColor: (STATUS[editStatus] ?? STATUS.available).color }]} />
          <Text style={styles.pickerBtnText}>{(STATUS[editStatus] ?? STATUS.available).label}</Text>
          <ChevronDown size={16} color={themeColors.textMuted} strokeWidth={1.75} />
        </TouchableOpacity>
        {showStatusPicker && (
          <View style={styles.optionsRow}>
            {Object.entries(STATUS).map(([key, val]) => (
              <TouchableOpacity
                key={key}
                style={[styles.optionChip, editStatus === key && { backgroundColor: val.color }]}
                onPress={() => { setEditStatus(key as any); setShowStatusPicker(false); }}
              >
                {/* Not '#fff': in dark mode `val.color` is the light end of each
                    hue (success #4ED37A, warningLabel #FF9500), where a white
                    label is ~1.7-2.2:1. labelOn measures both candidates. */}
                <Text style={[styles.optionChipText, editStatus === key && { color: labelOn(val.color) }]}>{val.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        <Text style={styles.fieldLabel}>Assigned Project</Text>
        <TouchableOpacity style={styles.pickerBtn} onPress={() => setShowProjectPicker(!showProjectPicker)}>
          <Text style={styles.pickerBtnText}>
            {editProjectId ? (projects.find(p => p.id === editProjectId)?.name ?? 'Unknown') : 'None'}
          </Text>
          <ChevronDown size={16} color={themeColors.textMuted} strokeWidth={1.75} />
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
          placeholderTextColor={themeColors.textMuted}
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
                <Wrench size={14} color={item.isOverdue ? themeColors.danger : themeColors.textMuted} strokeWidth={1.75} />
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

        <TouchableOpacity
          style={[styles.logBtn, !!logBlockedReason && { opacity: 0.5 }]}
          onPress={() => setShowLogModal(true)}
          disabled={!!logBlockedReason}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityState={{ disabled: !!logBlockedReason }}
          accessibilityHint={logBlockedReason ?? undefined}
          testID="log-usage-open"
        >
          <Clock size={16} color={"#FF6A1A"} strokeWidth={1.75} />
          <Text style={styles.logBtnText}>Log Today's Use</Text>
        </TouchableOpacity>
        {logBlockedReason ? (
          <Text style={styles.logBlockedText} testID="log-usage-blocked">{logBlockedReason}</Text>
        ) : null}

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
                <X size={20} color={themeColors.textMuted} strokeWidth={1.75} />
              </TouchableOpacity>
            </View>
            <Text style={styles.fieldLabel}>Hours Used</Text>
            <TextInput style={styles.input} value={logHours} onChangeText={setLogHours} keyboardType="numeric" placeholder="8" placeholderTextColor={themeColors.textMuted} />
            {/* Directly under the field that drives it: which job this lands on
                and what it costs there, recomputed as the hours are typed and
                stated before the write rather than after. See chargePreview for
                why the hours-per-day divisor is imported, not spelled out. */}
            {chargePreview ? (
              <Text style={styles.modalChargeNote} testID="log-usage-charge-note">{chargePreview}</Text>
            ) : null}
            <Text style={styles.fieldLabel}>Operator Name</Text>
            <TextInput style={styles.input} value={logOperator} onChangeText={setLogOperator} placeholder="Optional" placeholderTextColor={themeColors.textMuted} />
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
    ...cardSurface(t, { radius: 'panel', pad: 20, bordered: false }),
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
  // NOT cardSurface: this is a TextStyle on a <TextInput>, and cardSurface
  // returns a ViewStyle. The primitive is for view surfaces; a field is a
  // control that happens to be rounded.
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
    ...cardSurface(t, { radius: 'card', pad: 'none' }),
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
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
    ...cardSurface(t, { radius: 'card', pad: 'none', bordered: false }),
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
    ...cardSurface(t, { radius: 'card', pad: 14, bordered: false }),
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
    ...cardSurface(t, { radius: 'card', pad: 12, bordered: false }),
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
  logBlockedText: {
    marginTop: 8,
    fontSize: Type.caption1.fontSize,
    color: t.textSecondary,
    lineHeight: 17,
  },
  modalChargeNote: {
    fontSize: Type.caption1.fontSize,
    color: t.textSecondary,
    lineHeight: 17,
    marginTop: 6,
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
