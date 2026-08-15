// Permits screen
//
// Lists every permit across every project. The marketing site claims
// "track permits and inspections" — this is the screen that delivers it.
//
// Architecture notes:
//   - Source of truth is ProjectContext.permits (local AsyncStorage,
//     keyed `mageid_permits`). No Supabase table yet — when we add one,
//     mirror the rfis pattern in ProjectContext.
//   - Phase tagging is a free-text field. We considered a fixed enum
//     (Foundation / Rough-in / Final / Closeout) but every jurisdiction
//     names phases differently and I'd rather not paint users into a
//     corner. The chip filter in the header is built from whatever phases
//     actually exist in the data.
//   - Attachment uri is a local file:// — when we wire Supabase Storage
//     for permit scans, swap to a remote URL but keep the field name.
//
// Stat cards on top, filter row, then a card per permit. Tap a card to
// edit. The tile-grid + modal pattern matches project-detail per CLAUDE.md.

import React, { useState, useMemo, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Animated, Platform, Modal, Pressable, TextInput, KeyboardAvoidingView,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import {
  ClipboardCheck, Calendar, AlertTriangle, Check,
  Clock, Plus, X, Save, Camera, FileText, Trash2, ChevronDown, CalendarDays,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { PERMIT_TYPE_INFO, PERMIT_STATUS_INFO, SPECIAL_INSPECTION_LABELS } from '@/mocks/permits';
import { StatusPipeline } from '@/components/StatusPipeline';
import { stagesFor, visualStageFor, isSideBranch } from '@/utils/workflowPipelines';
import DatePickerModal from '@/components/DatePickerModal';
import type { Permit, PermitStatus, PermitType, SpecialInspectionCategory } from '@/types';
import { formatMoney } from '@/utils/formatters';
import { useProjects } from '@/contexts/ProjectContext';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { showAlert } from '@/utils/alert';

const PERMIT_TYPES: PermitType[] = ['building', 'electrical', 'plumbing', 'mechanical', 'demolition', 'grading', 'fire', 'occupancy', 'special_inspection', 'other'];

// IBC Ch.17 categories ordered the way they typically appear on a project
const SPECIAL_INSPECTION_TYPES: SpecialInspectionCategory[] = [
  'soils', 'concrete', 'masonry', 'structural_steel', 'cold_formed_steel',
  'wood', 'fire_resistive', 'sprayed_fireproof', 'smoke_control', 'special_cases',
];
const PERMIT_STATUSES: PermitStatus[] = ['applied', 'under_review', 'approved', 'denied', 'expired', 'inspection_scheduled', 'inspection_passed', 'inspection_failed'];

function PermitCard({ permit, onPress }: { permit: Permit; onPress: () => void }) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const typeInfo = PERMIT_TYPE_INFO[permit.type] ?? PERMIT_TYPE_INFO.other;
  const statusInfo = PERMIT_STATUS_INFO[permit.status] ?? PERMIT_STATUS_INFO.applied;

  const isInspectionUpcoming = permit.inspectionDate &&
    (permit.status === 'inspection_scheduled') &&
    new Date(permit.inspectionDate).getTime() > Date.now();

  const daysUntilInspection = isInspectionUpcoming
    ? Math.ceil((new Date(permit.inspectionDate!).getTime() - Date.now()) / 86400000)
    : 0;

  return (
    <Animated.View style={[styles.permitCard, { transform: [{ scale: scaleAnim }] }]}>
      <TouchableOpacity
        onPress={onPress}
        onPressIn={() => Animated.spring(scaleAnim, { toValue: 0.97, useNativeDriver: true, speed: 50 }).start()}
        onPressOut={() => Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, speed: 50 }).start()}
        activeOpacity={1}
        style={styles.permitCardInner}
        testID={`permit-${permit.id}`}
      >
        <View style={styles.permitHeader}>
          <View style={[styles.permitTypeDot, { backgroundColor: typeInfo.color }]} />
          <Text style={styles.permitType}>{typeInfo.label} Permit</Text>
          <View style={[styles.statusBadge, { backgroundColor: statusInfo.bgColor }]}>
            <Text style={[styles.statusBadgeText, { color: statusInfo.color }]}>{statusInfo.label}</Text>
          </View>
        </View>

        {/* Descriptive name — first line of notes. Roadmap "Add to Permits"
            stores the permit's specific name here (the tracker has no title
            column), so cards show e.g. "200A panel upgrade" not just "Electrical". */}
        {(() => {
          const name = (permit.notes ?? '').split('\n')[0].trim();
          return name ? <Text style={styles.permitName} numberOfLines={2}>{name}</Text> : null;
        })()}

        {permit.permitNumber && (
          <Text style={styles.permitNumber}>#{permit.permitNumber}</Text>
        )}

        {/* IBC Ch.17 category chip — only renders for special inspections,
            making them visually distinct from regular permits in the list. */}
        {permit.type === 'special_inspection' && permit.specialInspectionCategory && (
          <View style={styles.specialCategoryChip}>
            <Text style={styles.specialCategoryText}>
              {SPECIAL_INSPECTION_LABELS[permit.specialInspectionCategory] ?? permit.specialInspectionCategory}
            </Text>
          </View>
        )}

        <Text style={styles.permitProject}>{permit.projectName}</Text>
        <Text style={styles.permitJurisdiction}>{permit.jurisdiction}</Text>
        {permit.type === 'special_inspection' && permit.inspectorName && (
          <Text style={styles.specialInspectorLine}>Inspector: {permit.inspectorName}</Text>
        )}

        {permit.phase && (
          <View style={styles.phaseTag}>
            <Text style={styles.phaseTagText}>{permit.phase}</Text>
          </View>
        )}

        {isInspectionUpcoming && (
          <View style={styles.inspectionAlert}>
            <Calendar size={13} color={Colors.purple} strokeWidth={1.75} />
            <Text style={styles.inspectionAlertText}>
              Inspection in {daysUntilInspection} day{daysUntilInspection !== 1 ? 's' : ''} — {new Date(permit.inspectionDate!).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
            </Text>
          </View>
        )}

        {permit.status === 'inspection_failed' && permit.inspectionNotes && (
          <View style={styles.failedAlert}>
            <AlertTriangle size={13} color={themeColors.dangerLabel} strokeWidth={1.75} />
            <Text style={styles.failedAlertText} numberOfLines={2}>{permit.inspectionNotes}</Text>
          </View>
        )}

        {permit.attachmentUri && (
          <View style={styles.attachRow}>
            <FileText size={12} color={themeColors.textSecondary} strokeWidth={1.75} />
            <Text style={styles.attachText}>Permit document attached</Text>
          </View>
        )}

        <View style={styles.permitFooter}>
          <Text style={styles.permitFee}>{formatMoney(permit.fee)}</Text>
          <Text style={styles.permitDate}>
            Applied {new Date(permit.appliedDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </Text>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}


interface PermitFormState {
  projectId: string;
  type: PermitType;
  permitNumber: string;
  jurisdiction: string;
  status: PermitStatus;
  appliedDate: string;
  inspectionDate: string;
  inspectionNotes: string;
  fee: string;
  phase: string;
  notes: string;
  attachmentUri?: string;
  // IBC Ch.17 special-inspection extras — populated only when type === 'special_inspection'.
  specialInspectionCategory?: SpecialInspectionCategory;
  inspectorName?: string;
  lastReportSummary?: string;
  lastReportDate?: string;
}

const EMPTY_FORM: PermitFormState = {
  projectId: '',
  type: 'building',
  permitNumber: '',
  jurisdiction: '',
  status: 'applied',
  appliedDate: new Date().toISOString().slice(0, 10),
  inspectionDate: '',
  inspectionNotes: '',
  fee: '',
  phase: '',
  notes: '',
};

export default function PermitsScreen() {
  const { canAccess } = useTierAccess();
  const router = useRouter();
  // Permit + inspection tracking is a Pro-tier field-PM capability — it rolls
  // up fees and drives the inspection countdown, matching the paid siblings in
  // this cluster (material-receipt is also 'job_costing'/Pro). Pre-fix the
  // screen had NO gate at all while every sibling gated, which read as an
  // oversight + a monetization leak. Gated on the closest existing FeatureKey;
  // see FLAG note — a dedicated 'permits_inspections' key would be cleaner but
  // lives in the shared useTierAccess hook.
  if (!canAccess('job_costing')) {
    return (
      <Paywall
        visible
        feature="Permits & Inspections"
        requiredTier="pro"
        onClose={() => router.back()}
      />
    );
  }
  return <PermitsScreenInner />;
}

function PermitsScreenInner() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const insetTopWeb = (insets.top || 16) + 4;
  const { projects, permits, addPermit, updatePermit, deletePermit } = useProjects();
  const [selectedFilter, setSelectedFilter] = useState<string>('all');
  const [editingPermit, setEditingPermit] = useState<Permit | null>(null);
  const [showForm, setShowForm] = useState<boolean>(false);
  const [form, setForm] = useState<PermitFormState>(EMPTY_FORM);
  const [pickerOpen, setPickerOpen] = useState<'project' | 'type' | 'status' | 'specialCategory' | null>(null);
  // Which date field the DatePickerModal is currently editing (null = closed).
  const [dateField, setDateField] = useState<'appliedDate' | 'inspectionDate' | 'lastReportDate' | null>(null);

  const filters = [
    { id: 'all', label: 'All' },
    { id: 'active', label: 'Active' },
    { id: 'inspections', label: 'Inspections' },
    { id: 'pending', label: 'Pending' },
  ];

  const phaseFilters = useMemo(() => {
    const phases = new Set<string>();
    permits.forEach(p => { if (p.phase?.trim()) phases.add(p.phase.trim()); });
    return Array.from(phases).slice(0, 8);
  }, [permits]);

  const filtered = useMemo(() => {
    let list = permits;
    if (selectedFilter === 'active') list = list.filter(p => ['approved', 'inspection_scheduled', 'inspection_passed'].includes(p.status));
    else if (selectedFilter === 'inspections') list = list.filter(p => p.status.startsWith('inspection'));
    else if (selectedFilter === 'pending') list = list.filter(p => ['applied', 'under_review'].includes(p.status));
    else if (selectedFilter.startsWith('phase:')) {
      const phase = selectedFilter.slice('phase:'.length);
      list = list.filter(p => p.phase === phase);
    }
    return list;
  }, [permits, selectedFilter]);

  const stats = useMemo(() => {
    const totalFees = permits.reduce((s, p) => s + p.fee, 0);
    const upcomingInspections = permits.filter(p =>
      p.status === 'inspection_scheduled' && p.inspectionDate && new Date(p.inspectionDate).getTime() > Date.now()
    ).length;
    const pending = permits.filter(p => ['applied', 'under_review'].includes(p.status)).length;
    const passed = permits.filter(p => ['approved', 'inspection_passed'].includes(p.status)).length;
    const failed = permits.filter(p => p.status === 'inspection_failed').length;
    const denied = permits.filter(p => p.status === 'denied').length;
    return { totalFees, upcomingInspections, pending, passed, failed, denied };
  }, [permits]);

  // Surface the very next inspection so the GC sees it without scrolling.
  // Sorted by inspectionDate ascending so we always show the closest one.
  // Anything "scheduled in the past" is excluded (those need a status fix).
  const nextInspection = useMemo(() => {
    const upcoming = permits
      .filter(p => p.status === 'inspection_scheduled' && p.inspectionDate)
      .filter(p => new Date(p.inspectionDate!).getTime() > Date.now())
      .sort((a, b) => new Date(a.inspectionDate!).getTime() - new Date(b.inspectionDate!).getTime());
    return upcoming[0] ?? null;
  }, [permits]);

  // Failed-inspection alerts — these block work until reinspection so the
  // GC needs to see them prominently. Same logic for denied permits.
  const blockers = useMemo(() => {
    return permits.filter(p => p.status === 'inspection_failed' || p.status === 'denied');
  }, [permits]);

  const openNewForm = useCallback(() => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setEditingPermit(null);
    setForm({
      ...EMPTY_FORM,
      projectId: projects[0]?.id ?? '',
    });
    setShowForm(true);
  }, [projects]);

  const openEditForm = useCallback((permit: Permit) => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setEditingPermit(permit);
    setForm({
      projectId: permit.projectId,
      type: permit.type,
      permitNumber: permit.permitNumber ?? '',
      jurisdiction: permit.jurisdiction,
      status: permit.status,
      appliedDate: permit.appliedDate.slice(0, 10),
      inspectionDate: permit.inspectionDate?.slice(0, 10) ?? '',
      inspectionNotes: permit.inspectionNotes ?? '',
      fee: String(permit.fee),
      phase: permit.phase ?? '',
      notes: permit.notes ?? '',
      attachmentUri: permit.attachmentUri,
      specialInspectionCategory: permit.specialInspectionCategory,
      inspectorName: permit.inspectorName ?? '',
      lastReportSummary: permit.lastReportSummary ?? '',
      lastReportDate: permit.lastReportDate?.slice(0, 10) ?? '',
    });
    setShowForm(true);
  }, []);

  const closeForm = useCallback(() => {
    setShowForm(false);
    setPickerOpen(null);
  }, []);

  const handleAttach = useCallback(async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 0.8,
      });
      if (!result.canceled && result.assets[0]) {
        setForm(f => ({ ...f, attachmentUri: result.assets[0].uri }));
      }
    } catch (e) {
      console.error('[Permits] Attach error:', e);
      showAlert('Could not attach', 'Try again or pick a different file.');
    }
  }, []);

  const handleSave = useCallback(() => {
    if (!form.projectId) {
      showAlert('Pick a project', 'Permits are tracked per project — pick which one this belongs to.');
      return;
    }
    if (!form.jurisdiction.trim()) {
      showAlert('Missing jurisdiction', 'Add the issuing jurisdiction (e.g. "City of Phoenix, AZ").');
      return;
    }
    const project = projects.find(p => p.id === form.projectId);
    if (!project) {
      showAlert('Project not found', 'Pick a project from the list.');
      return;
    }
    const fee = Number(form.fee.replace(/[^0-9.]/g, '')) || 0;
    const payload: Omit<Permit, 'id' | 'createdAt' | 'updatedAt'> = {
      projectId: form.projectId,
      projectName: project.name,
      type: form.type,
      permitNumber: form.permitNumber.trim() || undefined,
      jurisdiction: form.jurisdiction.trim(),
      status: form.status,
      appliedDate: form.appliedDate ? new Date(form.appliedDate).toISOString() : new Date().toISOString(),
      inspectionDate: form.inspectionDate ? new Date(form.inspectionDate).toISOString() : undefined,
      inspectionNotes: form.inspectionNotes.trim() || undefined,
      fee,
      phase: form.phase.trim() || undefined,
      notes: form.notes.trim() || undefined,
      attachmentUri: form.attachmentUri,
      // IBC Ch.17 fields — only saved when type === 'special_inspection'
      // so we don't pollute regular permits with empty placeholders.
      specialInspectionCategory: form.type === 'special_inspection' ? form.specialInspectionCategory : undefined,
      inspectorName:    form.type === 'special_inspection' ? (form.inspectorName?.trim() || undefined)    : undefined,
      lastReportSummary: form.type === 'special_inspection' ? (form.lastReportSummary?.trim() || undefined) : undefined,
      lastReportDate:    form.type === 'special_inspection' && form.lastReportDate ? new Date(form.lastReportDate).toISOString() : undefined,
    };

    if (editingPermit) {
      updatePermit(editingPermit.id, payload);
    } else {
      addPermit(payload);
    }
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    closeForm();
  }, [form, projects, editingPermit, addPermit, updatePermit, closeForm]);

  const handleDelete = useCallback(() => {
    if (!editingPermit) return;
    showAlert(
      'Delete permit?',
      `This will remove ${editingPermit.jurisdiction} permit ${editingPermit.permitNumber ? `#${editingPermit.permitNumber}` : ''} from this project. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => {
          deletePermit(editingPermit.id);
          if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          closeForm();
        } },
      ],
    );
  }, [editingPermit, deletePermit, closeForm]);

  const selectedProjectName = projects.find(p => p.id === form.projectId)?.name ?? 'Pick a project';

  return (
    <View style={styles.container}>
      <Stack.Screen options={{
        title: 'Permits',
        headerStyle: { backgroundColor: themeColors.bg },
        headerTintColor: themeColors.accent,
        headerTitleStyle: { fontWeight: '700' as const, color: themeColors.text },
        headerRight: () => (
          <TouchableOpacity onPress={openNewForm} style={{ paddingHorizontal: 12, paddingVertical: 6 }} testID="new-permit-btn" accessibilityRole="button" accessibilityLabel="Add"><Plus size={22} color={themeColors.accent} strokeWidth={1.75} /></TouchableOpacity>
        ),
      }} />
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 30 }} showsVerticalScrollIndicator={false}>
        {/* Next-inspection hero — biggest visual on screen when there
            is one. Calculates days countdown live so "tomorrow" shows
            up amber. Tap to jump to the permit detail. */}
        {nextInspection && (() => {
          const days = Math.ceil((new Date(nextInspection.inspectionDate!).getTime() - Date.now()) / 86400000);
          const dayLabel = days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `In ${days} days`;
          const urgent = days <= 1;
          const typeInfo = PERMIT_TYPE_INFO[nextInspection.type] ?? PERMIT_TYPE_INFO.other;
          return (
            <TouchableOpacity
              style={[styles.nextInspectionCard, urgent && styles.nextInspectionUrgent]}
              onPress={() => openEditForm(nextInspection)}
              activeOpacity={0.85}
              testID="next-inspection-hero"
            >
              <View style={styles.nextInspectionTop}>
                <View style={[styles.nextInspectionBadge, { backgroundColor: urgent ? themeColors.dangerSoft : '#F3E5F5' }]}>
                  <Calendar size={14} color={urgent ? themeColors.dangerLabel : Colors.purple} strokeWidth={1.75} />
                  <Text style={[styles.nextInspectionBadgeText, { color: urgent ? themeColors.dangerLabel : Colors.purple }]}>
                    Next inspection · {dayLabel}
                  </Text>
                </View>
                <Text style={styles.nextInspectionDate}>
                  {new Date(nextInspection.inspectionDate!).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                </Text>
              </View>
              <Text style={styles.nextInspectionType}>{typeInfo.label} Inspection</Text>
              <Text style={styles.nextInspectionProject} numberOfLines={1}>
                {nextInspection.projectName} &middot; {nextInspection.jurisdiction}
              </Text>
              {nextInspection.permitNumber ? (
                <Text style={styles.nextInspectionPermitNum}>Permit #{nextInspection.permitNumber}</Text>
              ) : null}
            </TouchableOpacity>
          );
        })()}

        {/* Blockers — failed inspections + denied permits. These stop
            work entirely so they go above stats. Each one is tappable
            for fast follow-up. */}
        {blockers.length > 0 && (
          <View style={styles.blockersCard}>
            <View style={styles.blockersHeader}>
              <AlertTriangle size={14} color={themeColors.dangerLabel} strokeWidth={1.75} />
              <Text style={styles.blockersTitle}>
                {blockers.length} permit{blockers.length === 1 ? '' : 's'} blocking work
              </Text>
            </View>
            {blockers.map(b => (
              <TouchableOpacity key={b.id} style={styles.blockerRow} onPress={() => openEditForm(b)} activeOpacity={0.7}>
                <Text style={styles.blockerName}>
                  {(PERMIT_TYPE_INFO[b.type]?.label ?? b.type)} · {b.projectName}
                </Text>
                <Text style={styles.blockerStatus}>
                  {b.status === 'inspection_failed' ? 'Failed inspection' : 'Permit denied'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <View style={[styles.statIconWrap, { backgroundColor: themeColors.accent + '14' }]}>
              <ClipboardCheck size={16} color={themeColors.accent} strokeWidth={1.75} />
            </View>
            <Text style={styles.statValue}>{permits.length}</Text>
            <Text style={styles.statLabel}>Total</Text>
          </View>
          <View style={styles.statCard}>
            <View style={[styles.statIconWrap, { backgroundColor: '#F3E5F5' }]}>
              <Calendar size={16} color={Colors.purple} strokeWidth={1.75} />
            </View>
            <Text style={[styles.statValue, { color: Colors.purple }]}>{stats.upcomingInspections}</Text>
            <Text style={styles.statLabel}>Upcoming</Text>
          </View>
          <View style={styles.statCard}>
            <View style={[styles.statIconWrap, { backgroundColor: themeColors.warningSoft }]}>
              <Clock size={16} color={Colors.warningDark} strokeWidth={1.75} />
            </View>
            <Text style={[styles.statValue, { color: themeColors.warningLabel }]}>{stats.pending}</Text>
            <Text style={styles.statLabel}>Pending</Text>
          </View>
          <View style={styles.statCard}>
            <View style={[styles.statIconWrap, { backgroundColor: themeColors.successSoft }]}>
              <Check size={16} color={Colors.successDark} strokeWidth={1.75} />
            </View>
            <Text style={[styles.statValue, { color: themeColors.success }]}>{stats.passed}</Text>
            <Text style={styles.statLabel}>Passed</Text>
          </View>
        </View>

        <View style={styles.feeCard}>
          <Text style={styles.feeLabel}>Total Permit Fees</Text>
          <Text style={styles.feeValue}>{formatMoney(stats.totalFees)}</Text>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
        >
          {filters.map(f => (
            <TouchableOpacity
              key={f.id}
              style={[styles.filterChip, selectedFilter === f.id && styles.filterChipActive]}
              onPress={() => {
                setSelectedFilter(f.id);
                if (Platform.OS !== 'web') void Haptics.selectionAsync();
              }}
              activeOpacity={0.7}
            >
              <Text style={[styles.filterChipText, selectedFilter === f.id && styles.filterChipTextActive]}>
                {f.label}
              </Text>
            </TouchableOpacity>
          ))}
          {phaseFilters.map(phase => {
            const id = `phase:${phase}`;
            return (
              <TouchableOpacity
                key={id}
                style={[styles.filterChip, selectedFilter === id && styles.filterChipActive]}
                onPress={() => {
                  setSelectedFilter(id);
                  if (Platform.OS !== 'web') void Haptics.selectionAsync();
                }}
                activeOpacity={0.7}
              >
                <Text style={[styles.filterChipText, selectedFilter === id && styles.filterChipTextActive]}>
                  {phase}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <View style={styles.listSection}>
          {filtered.length === 0 ? (
            <View style={styles.emptyState}>
              <ClipboardCheck size={32} color={themeColors.textMuted} strokeWidth={1.75} />
              <Text style={styles.emptyTitle}>No permits yet</Text>
              <Text style={styles.emptySub}>Tap + above to log your first permit. We&apos;ll track inspections and renewal dates from there.</Text>
              <TouchableOpacity style={styles.emptyCta} onPress={openNewForm}>
                <Plus size={16} color="#fff" strokeWidth={1.75} />
                <Text style={styles.emptyCtaText}>New Permit</Text>
              </TouchableOpacity>
            </View>
          ) : (
            filtered.map(permit => (
              <PermitCard key={permit.id} permit={permit} onPress={() => openEditForm(permit)} />
            ))
          )}
        </View>
      </ScrollView>

      <Modal visible={showForm} transparent animationType="slide" onRequestClose={closeForm}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Pressable style={styles.modalOverlay} onPress={closeForm}>
            <Pressable style={[styles.modalCard, { paddingTop: Platform.OS === 'web' ? insetTopWeb : 16 }]} onPress={() => undefined}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>{editingPermit ? 'Edit Permit' : 'New Permit'}</Text>
                <TouchableOpacity onPress={closeForm} accessibilityRole="button" accessibilityLabel="Close"><X size={22} color={themeColors.textMuted} strokeWidth={1.75} /></TouchableOpacity>
              </View>

              {editingPermit && (
                <View style={{ marginBottom: 12 }}>
                  {/* A side branch has no position in either sequence, so the
                      breadcrumb anchors it at the first stage. Without this badge
                      the screen would claim an EXPIRED permit is "Applied" —
                      quieter than the old bug that called it "Approved", but still
                      wrong. The badge carries the real state; the breadcrumb just
                      stays rendered instead of collapsing. */}
                  {(isSideBranch('permit', form.status) || isSideBranch('permitInspection', form.status)) && (
                    <View style={styles.permitSideBranchBadge}>
                      <AlertTriangle size={13} color={themeColors.dangerLabel} strokeWidth={2} />
                      <Text style={styles.permitSideBranchText}>
                        {(PERMIT_STATUS_INFO[form.status]?.label) ?? form.status} — not on the normal path
                      </Text>
                    </View>
                  )}
                  {/* The application path. Ends at Approved — the permit is issued.
                      Inspections are a SEPARATE cycle below, not a continuation: a permit
                      does not pass through `denied` on the way to an inspection, and
                      collapsing them onto one line is what made `expired` and
                      `inspection_failed` both render as "Approved". */}
                  <StatusPipeline
                    stages={stagesFor('permit')}
                    current={visualStageFor('permit', form.status)}
                    startedAt={form.appliedDate ? new Date(form.appliedDate).toISOString() : undefined}
                    onAdvance={isSideBranch('permit', form.status) ? undefined : (next) => {
                      setForm(f => ({ ...f, status: next as PermitStatus }));
                    }}
                    advanceLabel={
                      form.status === 'applied' ? 'Move to review'
                      : form.status === 'under_review' ? 'Mark approved'
                      : undefined
                    }
                  />

                  {/* The second loop, shown once the permit is issued. inspection_failed is a
                      side branch of THIS pipeline — a failed inspection gets rescheduled, so
                      it anchors back at Scheduled rather than pretending to be Passed. */}
                  {(form.status === 'approved' || form.status.startsWith('inspection_')) && (
                    <StatusPipeline
                      stages={stagesFor('permitInspection')}
                      current={visualStageFor('permitInspection', form.status)}
                      dueAt={form.inspectionDate ? new Date(form.inspectionDate).toISOString() : undefined}
                      onAdvance={isSideBranch('permitInspection', form.status) ? undefined : (next) => {
                        setForm(f => ({ ...f, status: next as PermitStatus }));
                      }}
                      advanceLabel={
                        form.status === 'approved' ? 'Schedule inspection'
                        : form.status === 'inspection_scheduled' ? 'Mark inspection passed'
                        : undefined
                      }
                    />
                  )}
                </View>
              )}

              <ScrollView style={{ maxHeight: 520 }} keyboardShouldPersistTaps="handled">
                <Text style={styles.formLabel}>Project *</Text>
                <TouchableOpacity style={styles.formPicker} onPress={() => setPickerOpen(pickerOpen === 'project' ? null : 'project')}>
                  <Text style={styles.formPickerText}>{selectedProjectName}</Text>
                  <ChevronDown size={16} color={themeColors.textMuted} strokeWidth={1.75} />
                </TouchableOpacity>
                {pickerOpen === 'project' && (
                  <View style={styles.pickerOptions}>
                    {projects.length === 0 ? (
                      <Text style={styles.pickerEmpty}>No projects yet — create one first.</Text>
                    ) : projects.map(p => (
                      <TouchableOpacity
                        key={p.id}
                        style={[styles.pickerRow, form.projectId === p.id && styles.pickerRowActive]}
                        onPress={() => { setForm(f => ({ ...f, projectId: p.id })); setPickerOpen(null); }}
                      >
                        <Text style={[styles.pickerRowText, form.projectId === p.id && styles.pickerRowTextActive]}>{p.name}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

                <Text style={styles.formLabel}>Type</Text>
                <TouchableOpacity style={styles.formPicker} onPress={() => setPickerOpen(pickerOpen === 'type' ? null : 'type')}>
                  <Text style={styles.formPickerText}>{(PERMIT_TYPE_INFO[form.type]?.label) ?? form.type}</Text>
                  <ChevronDown size={16} color={themeColors.textMuted} strokeWidth={1.75} />
                </TouchableOpacity>
                {pickerOpen === 'type' && (
                  <View style={styles.pickerOptions}>
                    {PERMIT_TYPES.map(t => (
                      <TouchableOpacity
                        key={t}
                        style={[styles.pickerRow, form.type === t && styles.pickerRowActive]}
                        onPress={() => { setForm(f => ({ ...f, type: t })); setPickerOpen(null); }}
                      >
                        <Text style={[styles.pickerRowText, form.type === t && styles.pickerRowTextActive]}>{PERMIT_TYPE_INFO[t]?.label ?? t}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

                {/* IBC Ch.17 sub-fields — only render when the user
                    picked Special Inspection. Keeps the form short for
                    regular permit types so it doesn't feel cluttered. */}
                {form.type === 'special_inspection' && (
                  <>
                    <Text style={styles.formLabel}>IBC Ch.17 category</Text>
                    <TouchableOpacity
                      style={styles.formPicker}
                      onPress={() => setPickerOpen(pickerOpen === 'specialCategory' ? null : 'specialCategory')}
                      testID="permit-special-category-picker"
                    >
                      <Text style={styles.formPickerText}>
                        {form.specialInspectionCategory ? SPECIAL_INSPECTION_LABELS[form.specialInspectionCategory] : 'Pick a category'}
                      </Text>
                      <ChevronDown size={16} color={themeColors.textMuted} strokeWidth={1.75} />
                    </TouchableOpacity>
                    {pickerOpen === 'specialCategory' && (
                      <View style={styles.pickerOptions}>
                        {SPECIAL_INSPECTION_TYPES.map(c => (
                          <TouchableOpacity
                            key={c}
                            style={[styles.pickerRow, form.specialInspectionCategory === c && styles.pickerRowActive]}
                            onPress={() => { setForm(f => ({ ...f, specialInspectionCategory: c })); setPickerOpen(null); }}
                          >
                            <Text style={[styles.pickerRowText, form.specialInspectionCategory === c && styles.pickerRowTextActive]}>
                              {SPECIAL_INSPECTION_LABELS[c]}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}

                    <Text style={styles.formLabel}>Inspector / agency</Text>
                    <TextInput
                      style={styles.formInput}
                      value={form.inspectorName ?? ''}
                      onChangeText={t => setForm(f => ({ ...f, inspectorName: t }))}
                      placeholder='e.g. "Geotek Engineering — Lic. STX-4112"'
                      placeholderTextColor={themeColors.textMuted}
                    />

                    <Text style={styles.formLabel}>Last report date</Text>
                    <TouchableOpacity
                      style={styles.formPicker}
                      onPress={() => { setPickerOpen(null); setDateField('lastReportDate'); }}
                      testID="permit-last-report-date"
                    >
                      <CalendarDays size={16} color={themeColors.textMuted} strokeWidth={1.75} />
                      <Text style={[styles.formPickerText, { marginLeft: 8 }, !form.lastReportDate && { color: themeColors.textMuted }]}>
                        {form.lastReportDate ? formatDateLabel(form.lastReportDate) : 'Pick a date'}
                      </Text>
                    </TouchableOpacity>

                    <Text style={styles.formLabel}>Last report summary</Text>
                    <TextInput
                      style={[styles.formInput, { minHeight: 60, textAlignVertical: 'top' as const }]}
                      value={form.lastReportSummary ?? ''}
                      onChangeText={t => setForm(f => ({ ...f, lastReportSummary: t }))}
                      placeholder="One-line summary of findings, e.g. 'Concrete sample 4-day compressive 4180 psi — passing'"
                      placeholderTextColor={themeColors.textMuted}
                      multiline
                    />
                  </>
                )}

                <Text style={styles.formLabel}>Status</Text>
                <TouchableOpacity style={styles.formPicker} onPress={() => setPickerOpen(pickerOpen === 'status' ? null : 'status')}>
                  <Text style={styles.formPickerText}>{(PERMIT_STATUS_INFO[form.status]?.label) ?? form.status}</Text>
                  <ChevronDown size={16} color={themeColors.textMuted} strokeWidth={1.75} />
                </TouchableOpacity>
                {pickerOpen === 'status' && (
                  <View style={styles.pickerOptions}>
                    {PERMIT_STATUSES.map(s => (
                      <TouchableOpacity
                        key={s}
                        style={[styles.pickerRow, form.status === s && styles.pickerRowActive]}
                        onPress={() => { setForm(f => ({ ...f, status: s })); setPickerOpen(null); }}
                      >
                        <Text style={[styles.pickerRowText, form.status === s && styles.pickerRowTextActive]}>{PERMIT_STATUS_INFO[s]?.label ?? s}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

                <Text style={styles.formLabel}>Permit Number</Text>
                <TextInput
                  style={styles.formInput}
                  value={form.permitNumber}
                  onChangeText={t => setForm(f => ({ ...f, permitNumber: t }))}
                  placeholder="e.g. BP-2026-04521"
                  placeholderTextColor={themeColors.textMuted}
                />

                <Text style={styles.formLabel}>Jurisdiction *</Text>
                <TextInput
                  style={styles.formInput}
                  value={form.jurisdiction}
                  onChangeText={t => setForm(f => ({ ...f, jurisdiction: t }))}
                  placeholder="City of Phoenix, AZ"
                  placeholderTextColor={themeColors.textMuted}
                />

                <Text style={styles.formLabel}>Phase Tag</Text>
                <TextInput
                  style={styles.formInput}
                  value={form.phase}
                  onChangeText={t => setForm(f => ({ ...f, phase: t }))}
                  placeholder="e.g. Foundation, Rough-in, Final"
                  placeholderTextColor={themeColors.textMuted}
                />

                <View style={styles.formRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.formLabel}>Applied Date</Text>
                    <TouchableOpacity
                      style={styles.formPicker}
                      onPress={() => { setPickerOpen(null); setDateField('appliedDate'); }}
                      testID="permit-applied-date"
                    >
                      <CalendarDays size={16} color={themeColors.textMuted} strokeWidth={1.75} />
                      <Text style={[styles.formPickerText, { marginLeft: 8 }, !form.appliedDate && { color: themeColors.textMuted }]}>
                        {form.appliedDate ? formatDateLabel(form.appliedDate) : 'Pick a date'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.formLabel}>Inspection Date</Text>
                    <TouchableOpacity
                      style={styles.formPicker}
                      onPress={() => { setPickerOpen(null); setDateField('inspectionDate'); }}
                      testID="permit-inspection-date"
                    >
                      <CalendarDays size={16} color={themeColors.textMuted} strokeWidth={1.75} />
                      <Text style={[styles.formPickerText, { marginLeft: 8 }, !form.inspectionDate && { color: themeColors.textMuted }]}>
                        {form.inspectionDate ? formatDateLabel(form.inspectionDate) : 'Pick a date'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>

                <Text style={styles.formLabel}>Fee ($)</Text>
                <TextInput
                  style={styles.formInput}
                  value={form.fee}
                  onChangeText={t => setForm(f => ({ ...f, fee: t.replace(/[^0-9.]/g, '') }))}
                  placeholder="0.00"
                  keyboardType="decimal-pad"
                  placeholderTextColor={themeColors.textMuted}
                />

                <Text style={styles.formLabel}>Inspection Notes</Text>
                <TextInput
                  style={[styles.formInput, { minHeight: 70, textAlignVertical: 'top' }]}
                  value={form.inspectionNotes}
                  onChangeText={t => setForm(f => ({ ...f, inspectionNotes: t }))}
                  placeholder="Any inspector notes / required corrections"
                  placeholderTextColor={themeColors.textMuted}
                  multiline
                />

                <Text style={styles.formLabel}>General Notes</Text>
                <TextInput
                  style={[styles.formInput, { minHeight: 70, textAlignVertical: 'top' }]}
                  value={form.notes}
                  onChangeText={t => setForm(f => ({ ...f, notes: t }))}
                  placeholder="Internal notes (not on the permit itself)"
                  placeholderTextColor={themeColors.textMuted}
                  multiline
                />

                <Text style={styles.formLabel}>Permit Document</Text>
                <TouchableOpacity style={styles.attachBtn} onPress={handleAttach} activeOpacity={0.7}>
                  <Camera size={16} color={themeColors.accent} strokeWidth={1.75} />
                  <Text style={styles.attachBtnText}>
                    {form.attachmentUri ? 'Replace attachment' : 'Attach permit scan'}
                  </Text>
                </TouchableOpacity>
                {form.attachmentUri && (
                  <Text style={styles.attachHint} numberOfLines={1}>{form.attachmentUri}</Text>
                )}
              </ScrollView>

              <View style={styles.formActions}>
                {editingPermit && (
                  <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete} accessibilityRole="button" accessibilityLabel="Delete"><Trash2 size={16} color={themeColors.danger} strokeWidth={1.75} /></TouchableOpacity>
                )}
                <TouchableOpacity style={styles.saveBtn} onPress={handleSave} testID="permit-save-btn">
                  <Save size={16} color="#fff" strokeWidth={1.75} />
                  <Text style={styles.saveBtnText}>{editingPermit ? 'Update' : 'Create Permit'}</Text>
                </TouchableOpacity>
              </View>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      {/* Shared date picker for the permit form's three date fields. Applied
          + last-report dates are "today or earlier"; the inspection date can
          be scheduled in the future (it drives the countdown hero), so we
          allow future picks only for that field. */}
      <DatePickerModal
        visible={dateField !== null}
        value={dateField ? (form[dateField] ?? '') : ''}
        allowFuture={dateField === 'inspectionDate'}
        title={
          dateField === 'appliedDate' ? 'Applied date'
          : dateField === 'inspectionDate' ? 'Inspection date'
          : 'Last report date'
        }
        onClose={() => setDateField(null)}
        onChange={(iso) => {
          const field = dateField;
          if (field) setForm(f => ({ ...f, [field]: iso }));
        }}
      />
    </View>
  );
}

// Formats a stored date (either a 'YYYY-MM-DD' slice or a full ISO string)
// into a short, human label for the permit date-picker buttons.
function formatDateLabel(value: string): string {
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  // ── Next-inspection hero ──
  nextInspectionCard: {
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.panel,
    padding: 16,
    borderWidth: 1.5,
    borderColor: '#6A1B9A' + '30',
    shadowColor: '#6A1B9A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
  },
  nextInspectionUrgent: {
    borderColor: '#C62828' + '40',
    shadowColor: '#C62828',
    shadowOpacity: 0.12,
  },
  nextInspectionTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    flexWrap: 'wrap',
    gap: 6,
  },
  nextInspectionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Tokens.radius.full,
  },
  nextInspectionBadgeText: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '800' as const,
    letterSpacing: 0.4,
    textTransform: 'uppercase' as const,
  },
  nextInspectionDate: {
    fontSize: Type.caption1.fontSize,
    color: t.textSecondary,
    fontWeight: '600' as const,
  },
  nextInspectionType: {
    fontSize: Type.title2.fontSize,
    fontWeight: '800' as const,
    color: t.text,
    letterSpacing: -0.4,
    marginBottom: 4,
  },
  nextInspectionProject: {
    fontSize: Type.footnote.fontSize,
    color: t.textSecondary,
    fontWeight: '600' as const,
  },
  nextInspectionPermitNum: {
    fontSize: Type.caption2.fontSize,
    color: t.textMuted,
    fontWeight: '600' as const,
    marginTop: 4,
    fontVariant: ['tabular-nums'],
  },
  // ── Blockers (failed/denied) ──
  blockersCard: {
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: t.dangerSoft,
    borderRadius: Tokens.radius.card,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: t.dangerLabel + '30',
    gap: 8,
  },
  blockersHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  blockersTitle: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '800' as const,
    color: t.dangerLabel,
    letterSpacing: 0.3,
    textTransform: 'uppercase' as const,
  },
  blockerRow: {
    // t.surface, NOT white — in dark theme a white row under t.text (cream)
    // rendered the blocked-permit names at ~1.08:1 (invisible).
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 6,
  },
  blockerName: {
    flex: 1,
    fontSize: Type.caption1.fontSize,
    fontWeight: '700' as const,
    color: t.text,
  },
  blockerStatus: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '700' as const,
    color: t.dangerLabel,
  },
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 8,
    paddingTop: 16,
    marginBottom: 12,
  },
  statCard: {
    flex: 1,
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.card,
    padding: 12,
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: t.line,
  },
  statIconWrap: { width: 30, height: 30, borderRadius: Tokens.radius.sm, alignItems: 'center', justifyContent: 'center' },
  statValue: { fontSize: Type.subheadline.fontSize, fontWeight: '700' as const, color: t.text },
  statLabel: { fontSize: Type.caption2.fontSize, color: t.textSecondary },
  feeCard: {
    marginHorizontal: 16,
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.lg,
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: t.line,
  },
  feeLabel: { fontSize: Type.bodyCompact.fontSize, color: t.textSecondary, fontWeight: '500' as const },
  feeValue: { fontSize: Type.title3.fontSize, fontWeight: '700' as const, color: t.text },
  filterRow: { paddingHorizontal: 16, gap: 8, paddingBottom: 16 },
  filterChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: t.surface,
    borderWidth: 1,
    borderColor: t.line,
  },
  filterChipActive: { backgroundColor: t.accent, borderColor: t.accent },
  filterChipText: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: t.textSecondary },
  filterChipTextActive: { color: '#fff' },
  listSection: { paddingHorizontal: 16 },
  permitCard: {
    marginBottom: 10,
    borderRadius: Tokens.radius.lg,
    backgroundColor: t.surface,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  permitCardInner: { padding: 14, gap: 4 },
  permitName: { fontSize: Type.headline.fontSize, fontWeight: '700' as const, color: t.text, marginBottom: 2 },
  permitHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  permitTypeDot: { width: 8, height: 8, borderRadius: 4 },
  permitType: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: t.textSecondary, flex: 1 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: Tokens.radius.sm },
  statusBadgeText: { fontSize: Type.caption2.fontSize, fontWeight: '600' as const },
  permitNumber: { fontSize: Type.footnote.fontSize, fontWeight: '500' as const, color: t.textMuted },
  permitProject: { fontSize: Type.subhead.fontSize, fontWeight: '600' as const, color: t.text },
  permitJurisdiction: { fontSize: Type.footnote.fontSize, color: t.textSecondary },
  // IBC Ch.17 category chip — sits between permit number and project name
  // on Special Inspection cards. Color tied to PERMIT_TYPE_INFO.special_inspection.
  specialCategoryChip: {
    alignSelf: 'flex-start' as const,
    backgroundColor: '#3949AB' + '15',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Tokens.radius.xs,
    marginTop: 4,
  },
  specialCategoryText: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '700' as const,
    color: '#3949AB',
    letterSpacing: 0.2,
  },
  specialInspectorLine: {
    fontSize: Type.caption2.fontSize,
    color: t.textMuted,
    marginTop: 2,
    fontStyle: 'italic' as const,
  },
  phaseTag: {
    alignSelf: 'flex-start',
    backgroundColor: t.surfaceAlt,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: Tokens.radius.xs,
    marginTop: 4,
  },
  phaseTagText: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const, color: t.textSecondary, letterSpacing: 0.4 },
  inspectionAlert: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F3E5F5',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Tokens.radius.sm,
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  inspectionAlertText: { fontSize: Type.caption1.fontSize, fontWeight: '500' as const, color: Colors.purple },
  failedAlert: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    backgroundColor: t.dangerSoft,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Tokens.radius.sm,
    marginTop: 4,
  },
  failedAlertText: { fontSize: Type.caption1.fontSize, color: t.dangerLabel, flex: 1 },
  attachRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  attachText: { fontSize: Type.caption2.fontSize, color: t.textSecondary, fontWeight: '500' as const },
  permitFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 },
  permitFee: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: t.text },
  permitDate: { fontSize: Type.caption1.fontSize, color: t.textMuted },
  emptyState: { alignItems: 'center', paddingVertical: 56, gap: 8 },
  emptyTitle: { fontSize: Type.body.fontSize, fontWeight: '600' as const, color: t.text },
  emptySub: { fontSize: Type.footnote.fontSize, color: t.textSecondary, textAlign: 'center', paddingHorizontal: 40, lineHeight: 18 },
  emptyCta: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginTop: 12,
    paddingHorizontal: 18, paddingVertical: 10, borderRadius: Tokens.radius.full,
    backgroundColor: t.accent,
  },
  emptyCtaText: { color: '#fff', fontWeight: '700' as const, fontSize: Type.bodyCompact.fontSize },

  modalOverlay: { flex: 1, backgroundColor: '#00000080', justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: t.bg,
    borderTopLeftRadius: 22, borderTopRightRadius: 22,
    paddingHorizontal: 16, paddingBottom: 24,
  },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12 },
  modalTitle: { fontSize: Type.subheadline.fontSize, fontWeight: '700' as const, color: t.text },
  formLabel: { fontSize: Type.caption1.fontSize, fontWeight: '700' as const, color: t.textSecondary, marginTop: 12, marginBottom: 6, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  formInput: {
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.md,
    paddingHorizontal: 12, paddingVertical: 10,
    color: t.text, fontSize: Type.subhead.fontSize,
    borderWidth: 1, borderColor: t.line,
  },
  formRow: { flexDirection: 'row', gap: 10 },
  formPicker: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.md,
    paddingHorizontal: 12, paddingVertical: 12,
    borderWidth: 1, borderColor: t.line,
  },
  formPickerText: { fontSize: Type.subhead.fontSize, color: t.text, flex: 1 },
  permitSideBranchBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    alignSelf: 'flex-start', marginBottom: 8,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: Tokens.radius.full,
    backgroundColor: t.surfaceAlt,
    borderWidth: 1, borderColor: t.dangerLabel,
  },
  permitSideBranchText: {
    fontSize: Type.caption1.fontSize, color: t.dangerLabel, fontWeight: '700' as const,
  },
  pickerOptions: { backgroundColor: t.surface, borderRadius: Tokens.radius.md, marginTop: 6, borderWidth: 1, borderColor: t.line, maxHeight: 220 },
  pickerRow: { paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: t.line + '60' },
  pickerRowActive: { backgroundColor: t.accent + '14' },
  pickerRowText: { fontSize: Type.bodyCompact.fontSize, color: t.text },
  pickerRowTextActive: { color: t.accent, fontWeight: '700' as const },
  pickerEmpty: { padding: 14, fontSize: Type.footnote.fontSize, color: t.textMuted, textAlign: 'center' },
  attachBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: t.accent + '14',
    borderRadius: Tokens.radius.md,
    paddingHorizontal: 14, paddingVertical: 12,
  },
  attachBtnText: { color: t.accent, fontWeight: '700' as const, fontSize: Type.bodyCompact.fontSize },
  attachHint: { fontSize: Type.caption2.fontSize, color: t.textMuted, marginTop: 4, paddingHorizontal: 4 },
  formActions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  saveBtn: {
    flex: 1,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: t.accent,
    borderRadius: Tokens.radius.card,
    paddingVertical: 14,
  },
  saveBtnText: { color: '#fff', fontWeight: '700' as const, fontSize: Type.subhead.fontSize },
  deleteBtn: {
    width: 50, height: 50,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.danger + '14',
    borderRadius: Tokens.radius.card,
  },
});
