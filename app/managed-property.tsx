// app/managed-property.tsx — a single managed property + the work orders
// logged against it. Reached from PropertyManagerHome.
//
// Layout follows the app's modal-in-screen convention: a back chevron
// header, an editable property card, then the work-order list with a
// "New work order" affordance. Adding a work order is an inline modal;
// tapping one opens /work-order for status + the contractor bridge.

import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, TextInput, Platform, KeyboardAvoidingView,
} from 'react-native';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft, Building2, MapPin, Plus, X, Wrench, ChevronRight, Trash2,
  Pencil, Check, AlertTriangle,
} from 'lucide-react-native';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useProperties } from '@/contexts/PropertyContext';
import {
  WORK_ORDER_STATUS_LABELS, WORK_ORDER_PRIORITIES, WORK_ORDER_PRIORITY_LABELS,
  type WorkOrder, type WorkOrderPriority, type WorkOrderStatus,
} from '@/types';
import { formatMoney } from '@/utils/formatters';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { showAlert } from '@/utils/alert';

const STATUS_COLORS: Record<WorkOrderStatus, string> = {
  open: '#FF6A1A',
  posted_for_bids: '#0D6CB1',
  assigned: '#7A3FF2',
  in_progress: '#C99700',
  done: '#16A34A',
  cancelled: '#9CA3AF',
};

const PRIORITY_COLORS: Record<WorkOrderPriority, string> = {
  low: '#9CA3AF',
  normal: '#0D6CB1',
  high: '#C99700',
  emergency: '#DC2626',
};

export default function ManagedPropertyScreen() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const router = useRouter();
  const params = useLocalSearchParams<{ propertyId?: string }>();
  const propertyId = params.propertyId ?? '';

  const {
    getProperty, updateProperty, deleteProperty,
    getWorkOrdersForProperty, addWorkOrder,
  } = useProperties();

  const property = getProperty(propertyId);
  const workOrders = useMemo(
    () => getWorkOrdersForProperty(propertyId)
      .slice()
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    [getWorkOrdersForProperty, propertyId],
  );

  // Edit-property modal state
  const [editOpen, setEditOpen] = useState(false);
  const [eName, setEName] = useState(property?.name ?? '');
  const [eAddress, setEAddress] = useState(property?.address ?? '');
  const [eType, setEType] = useState(property?.propertyType ?? '');
  const [eOwner, setEOwner] = useState(property?.ownerName ?? '');
  const [eOwnerPhone, setEOwnerPhone] = useState(property?.ownerPhone ?? '');

  // Add-work-order modal state
  const [woOpen, setWoOpen] = useState(false);
  const [woTitle, setWoTitle] = useState('');
  const [woDesc, setWoDesc] = useState('');
  const [woCategory, setWoCategory] = useState('');
  const [woPriority, setWoPriority] = useState<WorkOrderPriority>('normal');
  const [woBudget, setWoBudget] = useState('');

  const openEdit = useCallback(() => {
    setEName(property?.name ?? '');
    setEAddress(property?.address ?? '');
    setEType(property?.propertyType ?? '');
    setEOwner(property?.ownerName ?? '');
    setEOwnerPhone(property?.ownerPhone ?? '');
    setEditOpen(true);
  }, [property]);

  const saveEdit = useCallback(() => {
    if (!eName.trim()) return;
    updateProperty(propertyId, {
      name: eName.trim(),
      address: eAddress.trim() || undefined,
      propertyType: eType.trim() || undefined,
      ownerName: eOwner.trim() || undefined,
      ownerPhone: eOwnerPhone.trim() || undefined,
    });
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    setEditOpen(false);
  }, [eName, eAddress, eType, eOwner, eOwnerPhone, propertyId, updateProperty]);

  const handleDelete = useCallback(() => {
    showAlert(
      'Delete property?',
      `This removes "${property?.name}" and its ${workOrders.length} work order${workOrders.length === 1 ? '' : 's'}. This can't be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive', onPress: () => {
            deleteProperty(propertyId);
            router.back();
          },
        },
      ],
    );
  }, [property, workOrders.length, deleteProperty, propertyId, router]);

  const resetWoDraft = useCallback(() => {
    setWoTitle(''); setWoDesc(''); setWoCategory(''); setWoPriority('normal'); setWoBudget('');
  }, []);

  const handleAddWo = useCallback(() => {
    const title = woTitle.trim();
    if (!title) return;
    const budgetNum = parseFloat(woBudget.replace(/[$,\s]/g, ''));
    const created = addWorkOrder({
      propertyId,
      title,
      description: woDesc.trim() || undefined,
      category: woCategory.trim() || undefined,
      priority: woPriority,
      budget: Number.isFinite(budgetNum) && budgetNum > 0 ? Math.round(budgetNum) : undefined,
    });
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setWoOpen(false);
    resetWoDraft();
    router.push({ pathname: '/work-order' as never, params: { workOrderId: created.id } as never });
  }, [woTitle, woDesc, woCategory, woPriority, woBudget, propertyId, addWorkOrder, router, resetWoDraft]);

  if (!property) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={8}><ChevronLeft size={26} color={themeColors.accent} strokeWidth={1.75} /></TouchableOpacity>
          <Text style={styles.headerTitle} numberOfLines={1}>Property</Text>
        </View>
        <View style={styles.missingWrap}>
          <AlertTriangle size={28} color={themeColors.textMuted} strokeWidth={1.75} />
          <Text style={styles.missingText}>This property could not be found.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8} accessibilityLabel="Back">
          <ChevronLeft size={26} color={themeColors.accent} strokeWidth={1.75} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{property.name}</Text>
        <TouchableOpacity onPress={openEdit} hitSlop={8} accessibilityLabel="Edit property">
          <Pencil size={18} color={themeColors.accent} strokeWidth={1.75} />
        </TouchableOpacity>
      </View>

      <ScrollView
        {...fabScroll}
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }}
        showsVerticalScrollIndicator={false}
      >
        {/* Property card */}
        <View style={styles.propCard}>
          <View style={styles.propIcon}><Building2 size={26} color={themeColors.accent} strokeWidth={2} /></View>
          <Text style={styles.propName}>{property.name}</Text>
          {!!property.address && (
            <View style={styles.propMetaRow}>
              <MapPin size={13} color={themeColors.textMuted} strokeWidth={1.75} />
              <Text style={styles.propMetaText}>{property.address}</Text>
            </View>
          )}
          <View style={styles.propTagRow}>
            {!!property.propertyType && <View style={styles.tag}><Text style={styles.tagText}>{property.propertyType}</Text></View>}
            {!!property.units && <View style={styles.tag}><Text style={styles.tagText}>{property.units} units</Text></View>}
            {!!property.ownerName && <View style={styles.tag}><Text style={styles.tagText}>Owner: {property.ownerName}</Text></View>}
          </View>
        </View>

        {/* Work orders */}
        <View style={styles.woHeadRow}>
          <Text style={styles.sectionTitle}>Work orders</Text>
          <TouchableOpacity style={styles.addWoBtn} onPress={() => setWoOpen(true)} activeOpacity={0.85} testID="add-work-order">
            <Plus size={15} color="#FFF" strokeWidth={1.75} />
            <Text style={styles.addWoBtnText}>New</Text>
          </TouchableOpacity>
        </View>

        {workOrders.length === 0 ? (
          <View style={styles.emptyWo}>
            <Wrench size={22} color={themeColors.textMuted} strokeWidth={1.75} />
            <Text style={styles.emptyWoText}>No work orders yet. Log a repair or maintenance task and dispatch it to a contractor.</Text>
          </View>
        ) : (
          workOrders.map(wo => (
            <WorkOrderRow
              key={wo.id}
              wo={wo}
              onPress={() => router.push({ pathname: '/work-order' as never, params: { workOrderId: wo.id } as never })}
              styles={styles}
              themeColors={themeColors}
            />
          ))
        )}

        <TouchableOpacity style={styles.deleteRow} onPress={handleDelete} activeOpacity={0.7}>
          <Trash2 size={15} color={themeColors.danger} strokeWidth={1.75} />
          <Text style={styles.deleteRowText}>Delete property</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Edit-property modal */}
      <Modal visible={editOpen} transparent animationType="slide" onRequestClose={() => setEditOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>Edit property</Text>
              <TouchableOpacity onPress={() => setEditOpen(false)} hitSlop={8}><X size={20} color={themeColors.textMuted} strokeWidth={1.75} /></TouchableOpacity>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <Field label="Name"><TextInput style={styles.input} value={eName} onChangeText={setEName} placeholderTextColor={themeColors.textMuted} /></Field>
              <Field label="Address"><TextInput style={styles.input} value={eAddress} onChangeText={setEAddress} placeholderTextColor={themeColors.textMuted} /></Field>
              <Field label="Type"><TextInput style={styles.input} value={eType} onChangeText={setEType} placeholderTextColor={themeColors.textMuted} /></Field>
              <Field label="Owner / client"><TextInput style={styles.input} value={eOwner} onChangeText={setEOwner} placeholderTextColor={themeColors.textMuted} /></Field>
              <Field label="Owner phone"><TextInput style={styles.input} value={eOwnerPhone} onChangeText={setEOwnerPhone} keyboardType="phone-pad" placeholderTextColor={themeColors.textMuted} /></Field>
            </ScrollView>
            <TouchableOpacity style={[styles.modalCta, !eName.trim() && styles.modalCtaDisabled]} onPress={saveEdit} disabled={!eName.trim()} activeOpacity={0.85}>
              <Check size={16} color="#FFF" strokeWidth={1.75} />
              <Text style={styles.modalCtaText}>Save</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Add-work-order modal */}
      <Modal visible={woOpen} transparent animationType="slide" onRequestClose={() => setWoOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHead}>
              <View style={styles.modalHeadIcon}><Wrench size={15} color="#FFF" strokeWidth={1.75} /></View>
              <Text style={styles.modalTitle}>New work order</Text>
              <TouchableOpacity onPress={() => { setWoOpen(false); resetWoDraft(); }} hitSlop={8}><X size={20} color={themeColors.textMuted} strokeWidth={1.75} /></TouchableOpacity>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <Field label="What needs doing?">
                <TextInput style={styles.input} value={woTitle} onChangeText={setWoTitle} placeholder="Kitchen sink leak" placeholderTextColor={themeColors.textMuted} autoFocus testID="wo-title" />
              </Field>
              <Field label="Details">
                <TextInput style={[styles.input, styles.inputMultiline]} value={woDesc} onChangeText={setWoDesc} placeholder="Under-sink supply line dripping; cabinet base swelling." placeholderTextColor={themeColors.textMuted} multiline textAlignVertical="top" />
              </Field>
              <Field label="Category">
                <TextInput style={styles.input} value={woCategory} onChangeText={setWoCategory} placeholder="Plumbing · HVAC · General" placeholderTextColor={themeColors.textMuted} />
              </Field>
              <Field label="Priority">
                <View style={styles.priorityRow}>
                  {WORK_ORDER_PRIORITIES.map(p => (
                    <TouchableOpacity
                      key={p}
                      style={[styles.priorityChip, woPriority === p && { backgroundColor: PRIORITY_COLORS[p] + '18', borderColor: PRIORITY_COLORS[p] }]}
                      onPress={() => setWoPriority(p)}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.priorityChipText, woPriority === p && { color: PRIORITY_COLORS[p] }]}>{WORK_ORDER_PRIORITY_LABELS[p]}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </Field>
              <Field label="Budget (optional)">
                <TextInput style={styles.input} value={woBudget} onChangeText={setWoBudget} placeholder="$500" placeholderTextColor={themeColors.textMuted} keyboardType="numeric" />
              </Field>
            </ScrollView>
            <TouchableOpacity style={[styles.modalCta, !woTitle.trim() && styles.modalCtaDisabled]} onPress={handleAddWo} disabled={!woTitle.trim()} activeOpacity={0.85} testID="wo-submit">
              <Plus size={16} color="#FFF" strokeWidth={1.75} />
              <Text style={styles.modalCtaText}>Create work order</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={{ marginBottom: 4 }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

function WorkOrderRow({ wo, onPress, styles, themeColors }: {
  wo: WorkOrder; onPress: () => void; styles: ReturnType<typeof makeStyles>; themeColors: ThemeColors;
}) {
  return (
    <TouchableOpacity style={styles.woCard} onPress={onPress} activeOpacity={0.85} testID={`wo-row-${wo.id}`}>
      <View style={[styles.woPriorityBar, { backgroundColor: PRIORITY_COLORS[wo.priority] }]} />
      <View style={{ flex: 1 }}>
        <Text style={styles.woTitle} numberOfLines={1}>{wo.title}</Text>
        <View style={styles.woMetaRow}>
          {!!wo.category && <Text style={styles.woMetaText}>{wo.category}</Text>}
          {wo.budget != null && <Text style={styles.woMetaText}>{formatMoney(wo.budget)}</Text>}
          {!!wo.assignedContactName && <Text style={styles.woMetaText} numberOfLines={1}>→ {wo.assignedContactName}</Text>}
        </View>
      </View>
      <View style={[styles.woStatusPill, { backgroundColor: STATUS_COLORS[wo.status] + '1A' }]}>
        <Text style={[styles.woStatusText, { color: STATUS_COLORS[wo.status] }]}>{WORK_ORDER_STATUS_LABELS[wo.status]}</Text>
      </View>
      <ChevronRight size={15} color={themeColors.textMuted} strokeWidth={1.75} />
    </TouchableOpacity>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: t.line,
  },
  headerTitle: { flex: 1, ...Type.serifHeadline, color: t.text },

  missingWrap: { alignItems: 'center', justifyContent: 'center', gap: 10, paddingTop: 80 },
  missingText: { fontSize: Type.footnote.fontSize, color: t.textMuted },

  propCard: { backgroundColor: t.surface, borderRadius: Tokens.radius.lg, padding: 18, borderWidth: 1, borderColor: t.line, alignItems: 'center', marginBottom: 20 },
  propIcon: { width: 56, height: 56, borderRadius: Tokens.radius.lg, backgroundColor: t.accent + '12', alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  propName: { fontSize: Type.title3.fontSize, fontWeight: '800', color: t.text, letterSpacing: -0.4, textAlign: 'center' },
  propMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 },
  propMetaText: { fontSize: Type.footnote.fontSize, color: t.textMuted, fontWeight: '600' },
  propTagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12, justifyContent: 'center' },
  tag: { backgroundColor: t.bg, borderRadius: Tokens.radius.full, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: t.line },
  tagText: { fontSize: Type.caption1.fontSize, color: t.text, fontWeight: '600' },

  woHeadRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sectionTitle: { fontSize: Type.subheadline.fontSize, fontWeight: '800', color: t.text, letterSpacing: -0.2 },
  addWoBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: t.accentFill, paddingHorizontal: 12, paddingVertical: 8, borderRadius: Tokens.radius.md },
  addWoBtnText: { color: '#FFF', fontSize: Type.footnote.fontSize, fontWeight: '700' },

  emptyWo: { backgroundColor: t.surface, borderRadius: Tokens.radius.lg, padding: 22, borderWidth: 1, borderColor: t.line, alignItems: 'center', gap: 8 },
  emptyWoText: { fontSize: Type.footnote.fontSize, color: t.textMuted, textAlign: 'center', lineHeight: 18, maxWidth: 300 },

  woCard: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: t.surface, borderRadius: Tokens.radius.lg, padding: 12, borderWidth: 1, borderColor: t.line, marginBottom: 8, overflow: 'hidden' },
  woPriorityBar: { width: 4, alignSelf: 'stretch', borderRadius: 2 },
  woTitle: { fontSize: Type.subhead.fontSize, fontWeight: '700', color: t.text },
  woMetaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 3 },
  woMetaText: { fontSize: Type.caption1.fontSize, color: t.textMuted, fontWeight: '600' },
  woStatusPill: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: Tokens.radius.full },
  woStatusText: { fontSize: Type.caption2.fontSize, fontWeight: '800', letterSpacing: 0.2 },

  deleteRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: 24, paddingVertical: 12 },
  deleteRowText: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: t.danger },

  // shared modal styles
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: t.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18, paddingBottom: 34, maxHeight: '88%' },
  modalHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: t.line, alignSelf: 'center', marginBottom: 14 },
  modalHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  modalHeadIcon: { width: 30, height: 30, borderRadius: 9, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center' },
  modalTitle: { flex: 1, fontSize: Type.subhead.fontSize, fontWeight: '800', color: t.text },
  fieldLabel: { fontSize: Type.caption1.fontSize, fontWeight: '700', color: t.textMuted, marginBottom: 6, marginTop: 10, textTransform: 'uppercase', letterSpacing: 0.4 },
  input: { backgroundColor: t.bg, borderWidth: 1, borderColor: t.line, borderRadius: Tokens.radius.md, paddingHorizontal: 12, paddingVertical: 12, fontSize: Type.bodyCompact.fontSize, color: t.text },
  inputMultiline: { minHeight: 72 },
  priorityRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  priorityChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: Tokens.radius.md, borderWidth: 1, borderColor: t.line, backgroundColor: t.bg },
  priorityChipText: { fontSize: Type.caption1.fontSize, fontWeight: '700', color: t.textMuted },
  modalCta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: t.accentFill, paddingVertical: 14, borderRadius: Tokens.radius.card, marginTop: 16 },
  modalCtaDisabled: { opacity: 0.5 },
  modalCtaText: { color: '#FFF', fontSize: Type.subhead.fontSize, fontWeight: '800' },
});
