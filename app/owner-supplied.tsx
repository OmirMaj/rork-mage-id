// owner-supplied.tsx — OFCI / OFOI tracker.
//
// PM audit's #1 missing primitive vs. Procore + Buildertrend. The
// owner is sourcing the appliances / fixtures / specialty items
// (Sub-Zero fridge, Wolf range, recessed lighting trim packs, the
// custom millwork the architect bid out separately, etc). The GC
// doesn't bill these but absolutely needs to track them:
//
//   - Schedule: if the dishwasher hasn't shown up by drywall close,
//     the install task slips and so does the inspection.
//   - Closeout binder: the homeowner wants the brand/model/SKU of
//     every fixture for warranty + future repair.
//   - Site logistics: what's coming this week + who's signing for
//     it (the homeowner, the GC, the millwork install crew).
//
// This screen is the cross-project dock the super opens Monday
// morning to scan "what's at risk this week" and "what's already
// on site, ready to install."
//
//   - Status pivot: At risk / In transit / On site / Installed / All
//   - "At risk" = need_by within next 7 days AND status not
//     'on_site' / 'installed' / 'cancelled'.
//   - Mode chip on each card: OFCI (owner-furnished, contractor-
//     installed — GC handles the install) vs. OFOI (owner-furnished,
//     owner-installed — homeowner does it themselves).
//   - "+ New item" → minimal modal: project, mode, description,
//     need_by, brand/model.

import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal,
  TextInput, Alert, Platform, KeyboardAvoidingView,
} from 'react-native';
import { Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  Plus, Package, ChevronDown, X, Check, AlertTriangle,
  Truck, Box, CheckCircle2, MoreVertical, Calendar,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { useOwnerSuppliedItems } from '@/hooks/useOwnerSuppliedItems';
import EmptyState from '@/components/EmptyState';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import type { OwnerSuppliedItem, OwnerSuppliedMode, OwnerSuppliedStatus } from '@/types';

type FilterKey = 'at_risk' | 'in_transit' | 'on_site' | 'installed' | 'all';

const STATUS_LABEL: Record<OwnerSuppliedStatus, string> = {
  planned: 'Planned',
  ordered: 'Ordered',
  in_transit: 'In transit',
  on_site: 'On site',
  installed: 'Installed',
  cancelled: 'Cancelled',
};

function statusTint(status: OwnerSuppliedStatus): string {
  switch (status) {
    case 'planned': return Colors.textMuted;
    case 'ordered': return Colors.info;
    case 'in_transit': return Colors.warning;
    case 'on_site': return Colors.primary;
    case 'installed': return Colors.success;
    case 'cancelled': return Colors.textMuted;
  }
}

function nextStatus(status: OwnerSuppliedStatus): OwnerSuppliedStatus | null {
  switch (status) {
    case 'planned': return 'ordered';
    case 'ordered': return 'in_transit';
    case 'in_transit': return 'on_site';
    case 'on_site': return 'installed';
    case 'installed': return null;
    case 'cancelled': return null;
  }
}

function nextStatusLabel(status: OwnerSuppliedStatus): string | null {
  const n = nextStatus(status);
  if (!n) return null;
  return `Mark ${STATUS_LABEL[n].toLowerCase()}`;
}

function dateLabel(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function isAtRisk(item: OwnerSuppliedItem): boolean {
  if (!item.needBy) return false;
  if (item.status === 'on_site' || item.status === 'installed' || item.status === 'cancelled') return false;
  const days = Math.round((Date.parse(item.needBy) - Date.now()) / 86_400_000);
  return Number.isFinite(days) && days <= 7;
}

function daysToNeedBy(item: OwnerSuppliedItem): number | null {
  if (!item.needBy) return null;
  const days = Math.round((Date.parse(item.needBy) - Date.now()) / 86_400_000);
  return Number.isFinite(days) ? days : null;
}

export default function OwnerSuppliedScreen() {
  const insets = useSafeAreaInsets();
  const { projects } = useProjects();
  const { items, addItem, updateItem, deleteItem, loading } = useOwnerSuppliedItems();
  const [filter, setFilter] = useState<FilterKey>('at_risk');
  const [composerOpen, setComposerOpen] = useState(false);

  const projectName = useMemo(
    () => new Map(projects.map(p => [p.id, p.name])),
    [projects],
  );

  const filtered = useMemo(() => {
    if (filter === 'at_risk') return items.filter(isAtRisk);
    if (filter === 'in_transit') return items.filter(i => i.status === 'in_transit' || i.status === 'ordered');
    if (filter === 'on_site') return items.filter(i => i.status === 'on_site');
    if (filter === 'installed') return items.filter(i => i.status === 'installed');
    return items.filter(i => i.status !== 'cancelled');
  }, [items, filter]);

  const sorted = useMemo(() =>
    [...filtered].sort((a, b) => {
      // At-risk first (most-overdue at top), then by need_by ascending.
      const aRisk = isAtRisk(a) ? 1 : 0;
      const bRisk = isAtRisk(b) ? 1 : 0;
      if (aRisk !== bRisk) return bRisk - aRisk;
      const aNeed = a.needBy ? Date.parse(a.needBy) : Infinity;
      const bNeed = b.needBy ? Date.parse(b.needBy) : Infinity;
      return aNeed - bNeed;
    }),
    [filtered],
  );

  const counts = useMemo(() => ({
    atRisk: items.filter(isAtRisk).length,
    inTransit: items.filter(i => i.status === 'in_transit' || i.status === 'ordered').length,
    onSite: items.filter(i => i.status === 'on_site').length,
    installed: items.filter(i => i.status === 'installed').length,
    all: items.filter(i => i.status !== 'cancelled').length,
  }), [items]);

  const advanceStatus = useCallback((item: OwnerSuppliedItem) => {
    const next = nextStatus(item.status);
    if (!next) return;
    const now = new Date().toISOString();
    const patch: Partial<OwnerSuppliedItem> = { status: next };
    if (next === 'on_site' && !item.deliveryAt) patch.deliveryAt = now;
    if (next === 'installed' && !item.installedAt) patch.installedAt = now;
    updateItem(item.id, patch);
    if (Platform.OS !== 'web') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }
  }, [updateItem]);

  const handleDelete = useCallback((item: OwnerSuppliedItem) => {
    Alert.alert(
      'Delete OFCI/OFOI item',
      `Remove "${item.description}"? This can't be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deleteItem(item.id),
        },
      ],
    );
  }, [deleteItem]);

  if (!loading && items.length === 0) {
    return (
      <View style={styles.container}>
        <Stack.Screen
          options={{
            title: 'OFCI / OFOI',
            headerStyle: { backgroundColor: Colors.background },
            headerTintColor: Colors.primary,
            headerTitleStyle: { fontWeight: '700' as const, color: Colors.text },
          }}
        />
        <EmptyState
          icon={<Package size={36} color={Colors.primary} strokeWidth={1.6} />}
          title="No owner-supplied items yet"
          message="Track every appliance, fixture, and specialty item the homeowner is sourcing. Tap + to add the Sub-Zero fridge, the Wolf range, that custom millwork — anything the GC isn't buying but needs to install."
        />
        <TouchableOpacity
          style={[styles.fab, { bottom: insets.bottom + 16 }]}
          activeOpacity={0.85}
          onPress={() => setComposerOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="New owner-supplied item"
        >
          <Plus size={20} color={Colors.background} />
          <Text style={styles.fabText}>New item</Text>
        </TouchableOpacity>

        <OwnerSuppliedComposerModal
          visible={composerOpen}
          projects={projects}
          onClose={() => setComposerOpen(false)}
          onSave={(input) => {
            addItem(input);
            setComposerOpen(false);
          }}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: 'OFCI / OFOI',
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.primary,
          headerTitleStyle: { fontWeight: '700' as const, color: Colors.text },
        }}
      />
      <ScrollView
        contentContainerStyle={{ paddingTop: 12, paddingBottom: insets.bottom + 88 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.headerRow}>
          <Text style={styles.headerTitle}>Owner-supplied</Text>
          <Text style={styles.headerCount}>{counts.all}</Text>
        </View>
        <Text style={styles.headerSub}>
          {counts.atRisk > 0
            ? `${counts.atRisk} at risk · ${counts.inTransit} en route · ${counts.onSite} on site · ${counts.installed} installed`
            : `${counts.inTransit} en route · ${counts.onSite} on site · ${counts.installed} installed`}
        </Text>

        {/* Filter chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          {([
            { key: 'at_risk' as const, label: `At risk (${counts.atRisk})`, icon: AlertTriangle },
            { key: 'in_transit' as const, label: `In transit (${counts.inTransit})`, icon: Truck },
            { key: 'on_site' as const, label: `On site (${counts.onSite})`, icon: Box },
            { key: 'installed' as const, label: `Installed (${counts.installed})`, icon: CheckCircle2 },
            { key: 'all' as const, label: `All (${counts.all})`, icon: Package },
          ]).map(c => {
            const active = filter === c.key;
            const Icon = c.icon;
            return (
              <TouchableOpacity
                key={c.key}
                onPress={() => {
                  setFilter(c.key);
                  if (Platform.OS !== 'web') void Haptics.selectionAsync().catch(() => {});
                }}
                style={[styles.chip, active && styles.chipActive]}
                activeOpacity={0.85}
                testID={`ofci-filter-${c.key}`}
              >
                <Icon size={11} color={active ? Colors.background : Colors.textSecondary} />
                <Text style={[styles.chipText, active && styles.chipTextActive]}>
                  {c.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Cards */}
        {sorted.length === 0 ? (
          <View style={styles.subEmpty}>
            <Text style={styles.subEmptyText}>
              {filter === 'at_risk' ? 'Nothing at risk this week.' : 'Nothing in this filter.'}
            </Text>
          </View>
        ) : (
          sorted.map(item => {
            const tint = statusTint(item.status);
            const days = daysToNeedBy(item);
            const overdue = days != null && days < 0 && item.status !== 'on_site' && item.status !== 'installed';
            const dueSoon = days != null && days >= 0 && days <= 7 && item.status !== 'on_site' && item.status !== 'installed';
            return (
              <View key={item.id} style={styles.card}>
                <View style={styles.cardHeader}>
                  <View style={[styles.modePill, item.mode === 'OFCI' ? styles.modePillOFCI : styles.modePillOFOI]}>
                    <Text style={[styles.modePillText, { color: item.mode === 'OFCI' ? Colors.primary : Colors.warning }]}>
                      {item.mode}
                    </Text>
                  </View>
                  <View style={[styles.statusPill, { backgroundColor: tint + '15', borderColor: tint }]}>
                    <Text style={[styles.statusPillText, { color: tint }]}>
                      {STATUS_LABEL[item.status]}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => handleDelete(item)}
                    style={styles.cardKebab}
                    accessibilityLabel="Delete item"
                  >
                    <MoreVertical size={14} color={Colors.textMuted} />
                  </TouchableOpacity>
                </View>

                <Text style={styles.cardProject} numberOfLines={1}>
                  {projectName.get(item.projectId) ?? 'Unknown project'}
                </Text>
                <Text style={styles.cardTitle} numberOfLines={2}>
                  {item.description}
                </Text>
                {(item.brand || item.model) ? (
                  <Text style={styles.cardSubModel} numberOfLines={1}>
                    {item.brand}{item.brand && item.model ? ' · ' : ''}{item.model}
                    {item.sku ? ` · SKU ${item.sku}` : ''}
                  </Text>
                ) : null}

                {/* Schedule chip */}
                {item.needBy ? (
                  <View
                    style={[
                      styles.scheduleChip,
                      overdue && styles.scheduleChipOverdue,
                      dueSoon && styles.scheduleChipDue,
                    ]}
                  >
                    <Calendar
                      size={11}
                      color={overdue ? Colors.error : dueSoon ? Colors.warning : Colors.textMuted}
                    />
                    <Text
                      style={[
                        styles.scheduleChipText,
                        overdue && { color: Colors.error },
                        dueSoon && { color: Colors.warning },
                      ]}
                    >
                      Need by {dateLabel(item.needBy)}
                      {overdue ? ` · ${Math.abs(days ?? 0)}d overdue` : ''}
                      {dueSoon && !overdue ? ` · in ${days}d` : ''}
                    </Text>
                  </View>
                ) : null}

                {item.vendor ? (
                  <Text style={styles.cardVendor} numberOfLines={1}>
                    Vendor: {item.vendor}
                  </Text>
                ) : null}

                {/* Action row */}
                {nextStatusLabel(item.status) ? (
                  <View style={styles.cardActions}>
                    <TouchableOpacity
                      style={[styles.actionBtn, styles.actionPrimary]}
                      onPress={() => advanceStatus(item)}
                      activeOpacity={0.85}
                      testID={`ofci-advance-${item.id}`}
                    >
                      <Check size={14} color={Colors.background} />
                      <Text style={[styles.actionBtnText, { color: Colors.background }]}>
                        {nextStatusLabel(item.status)}
                      </Text>
                    </TouchableOpacity>
                  </View>
                ) : null}
              </View>
            );
          })
        )}
      </ScrollView>

      {/* Floating add */}
      <TouchableOpacity
        style={[styles.fab, { bottom: insets.bottom + 16 }]}
        activeOpacity={0.85}
        onPress={() => setComposerOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="New owner-supplied item"
        testID="ofci-add"
      >
        <Plus size={20} color={Colors.background} />
        <Text style={styles.fabText}>New item</Text>
      </TouchableOpacity>

      <OwnerSuppliedComposerModal
        visible={composerOpen}
        projects={projects}
        onClose={() => setComposerOpen(false)}
        onSave={(input) => {
          addItem(input);
          setComposerOpen(false);
          if (Platform.OS !== 'web') {
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          }
        }}
      />
    </View>
  );
}

// ─── Composer modal ─────────────────────────────────────────────
function OwnerSuppliedComposerModal({
  visible, projects, onClose, onSave,
}: {
  visible: boolean;
  projects: ReturnType<typeof useProjects>['projects'];
  onClose: () => void;
  onSave: (input: Omit<OwnerSuppliedItem, 'id' | 'createdAt' | 'updatedAt'>) => void;
}) {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [mode, setMode] = useState<OwnerSuppliedMode>('OFCI');
  const [description, setDescription] = useState('');
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [vendor, setVendor] = useState('');
  const [needBy, setNeedBy] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);

  const reset = useCallback(() => {
    setProjectId(null);
    setMode('OFCI');
    setDescription('');
    setBrand('');
    setModel('');
    setVendor('');
    setNeedBy('');
  }, []);

  const handleSave = useCallback(() => {
    if (!projectId) {
      Alert.alert('Pick a project', 'Choose which project this item is for.');
      return;
    }
    if (!description.trim()) {
      Alert.alert('Description required', 'What is this item?');
      return;
    }
    onSave({
      projectId,
      mode,
      status: 'planned',
      description: description.trim(),
      brand: brand.trim() || undefined,
      model: model.trim() || undefined,
      vendor: vendor.trim() || undefined,
      needBy: needBy.trim() || undefined,
    });
    reset();
  }, [projectId, mode, description, brand, model, vendor, needBy, onSave, reset]);

  const selectedProject = projects.find(p => p.id === projectId);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => { reset(); onClose(); }}
    >
      <KeyboardAvoidingView
        style={styles.modalRoot}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.modalHeader}>
          <TouchableOpacity onPress={() => { reset(); onClose(); }} style={styles.modalClose}>
            <X size={20} color={Colors.text} />
          </TouchableOpacity>
          <Text style={styles.modalTitle}>New owner-supplied item</Text>
          <TouchableOpacity onPress={handleSave} style={styles.modalSave}>
            <Check size={18} color={Colors.background} />
            <Text style={styles.modalSaveText}>Save</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.modalBody}>
          <Text style={styles.label}>Project</Text>
          <TouchableOpacity
            style={styles.field}
            onPress={() => setPickerOpen(o => !o)}
            activeOpacity={0.85}
          >
            <Text style={[styles.fieldText, !selectedProject && styles.fieldPlaceholder]}>
              {selectedProject?.name ?? 'Pick a project'}
            </Text>
            <ChevronDown size={16} color={Colors.textMuted} />
          </TouchableOpacity>
          {pickerOpen && (
            <View style={styles.pickerList}>
              {projects.map(p => (
                <TouchableOpacity
                  key={p.id}
                  style={styles.pickerItem}
                  onPress={() => {
                    setProjectId(p.id);
                    setPickerOpen(false);
                  }}
                >
                  <Text style={styles.pickerItemText}>{p.name}</Text>
                  {p.id === projectId ? <Check size={14} color={Colors.primary} /> : null}
                </TouchableOpacity>
              ))}
            </View>
          )}

          <Text style={styles.label}>Mode</Text>
          <View style={styles.modeRow}>
            <TouchableOpacity
              style={[styles.modeBtn, mode === 'OFCI' && styles.modeBtnActive]}
              onPress={() => setMode('OFCI')}
              activeOpacity={0.85}
            >
              <Text style={[styles.modeBtnText, mode === 'OFCI' && styles.modeBtnTextActive]}>
                OFCI
              </Text>
              <Text style={styles.modeBtnSub}>Owner-furnished, contractor-installed</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modeBtn, mode === 'OFOI' && styles.modeBtnActive]}
              onPress={() => setMode('OFOI')}
              activeOpacity={0.85}
            >
              <Text style={[styles.modeBtnText, mode === 'OFOI' && styles.modeBtnTextActive]}>
                OFOI
              </Text>
              <Text style={styles.modeBtnSub}>Owner-furnished, owner-installed</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.label}>Description</Text>
          <TextInput
            value={description}
            onChangeText={setDescription}
            placeholder='Sub-Zero 36" panel-ready fridge'
            placeholderTextColor={Colors.textMuted}
            style={styles.input}
          />

          <View style={{ flexDirection: 'row' as const, gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Brand (optional)</Text>
              <TextInput
                value={brand}
                onChangeText={setBrand}
                placeholder="Sub-Zero, Wolf..."
                placeholderTextColor={Colors.textMuted}
                style={styles.input}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Model (optional)</Text>
              <TextInput
                value={model}
                onChangeText={setModel}
                placeholder="BI-36U/S"
                placeholderTextColor={Colors.textMuted}
                style={styles.input}
              />
            </View>
          </View>

          <Text style={styles.label}>Vendor (optional)</Text>
          <TextInput
            value={vendor}
            onChangeText={setVendor}
            placeholder="Ferguson, AJ Madison, local appliance store..."
            placeholderTextColor={Colors.textMuted}
            style={styles.input}
          />

          <Text style={styles.label}>Need by (optional)</Text>
          <TextInput
            value={needBy}
            onChangeText={setNeedBy}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={Colors.textMuted}
            style={styles.input}
          />

          <Text style={styles.helperText}>
            Item starts in &quot;Planned&quot; status. As the homeowner orders, the item ships, and
            it lands on site, advance the status from each card. The closeout binder pulls
            brand / model / SKU automatically when the project closes.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

  headerRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingHorizontal: 16,
    marginTop: 6,
  },
  headerTitle: {
    fontSize: Type.title2.fontSize,
    fontWeight: '800' as const,
    color: Colors.text,
    letterSpacing: -0.4,
  },
  headerCount: {
    fontSize: Type.title3.fontSize,
    fontWeight: '800' as const,
    color: Colors.primary,
  },
  headerSub: {
    paddingHorizontal: 16,
    fontSize: Type.footnote.fontSize,
    color: Colors.textMuted,
    marginBottom: 12,
  },

  chipRow: { flexDirection: 'row' as const, gap: 8, paddingHorizontal: 16, marginBottom: 12 },
  chip: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: Tokens.radius.full,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    backgroundColor: Colors.surface,
  },
  chipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: Colors.textSecondary },
  chipTextActive: { color: Colors.background },

  card: {
    backgroundColor: Colors.surface,
    borderRadius: Tokens.radius.lg,
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  cardHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    marginBottom: 8,
  },
  modePill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Tokens.radius.sm,
    borderWidth: 1,
  },
  modePillOFCI: { backgroundColor: Colors.primary + '15', borderColor: Colors.primary + '30' },
  modePillOFOI: { backgroundColor: Colors.warning + '15', borderColor: Colors.warning + '30' },
  modePillText: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '900' as const,
    letterSpacing: 0.6,
  },
  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: Tokens.radius.full,
    borderWidth: 1,
  },
  statusPillText: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '800' as const,
    letterSpacing: 0.3,
    textTransform: 'uppercase' as const,
  },
  cardKebab: { padding: 4, marginLeft: 'auto' as const },
  cardProject: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '700' as const,
    color: Colors.textMuted,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.4,
  },
  cardTitle: {
    fontSize: Type.subheadline.fontSize,
    fontWeight: '700' as const,
    color: Colors.text,
    marginTop: 2,
    lineHeight: 19,
  },
  cardSubModel: {
    fontSize: Type.footnote.fontSize,
    color: Colors.textSecondary,
    marginTop: 4,
  },
  cardVendor: {
    fontSize: Type.caption1.fontSize,
    color: Colors.textMuted,
    marginTop: 6,
  },

  scheduleChip: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    alignSelf: 'flex-start' as const,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginTop: 10,
    borderRadius: Tokens.radius.full,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    backgroundColor: Colors.surfaceAlt,
  },
  scheduleChipDue: {
    borderColor: Colors.warning + '60',
    backgroundColor: Colors.warning + '10',
  },
  scheduleChipOverdue: {
    borderColor: Colors.error + '60',
    backgroundColor: Colors.error + '10',
  },
  scheduleChipText: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },

  cardActions: {
    flexDirection: 'row' as const,
    gap: 8,
    marginTop: 12,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 6,
    paddingVertical: 10,
    borderRadius: Tokens.radius.md,
  },
  actionPrimary: { backgroundColor: Colors.primary },
  actionBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const },

  subEmpty: { paddingHorizontal: 24, paddingVertical: 24 },
  subEmptyText: { fontSize: Type.body.fontSize, color: Colors.textMuted, textAlign: 'center' as const },

  fab: {
    position: 'absolute' as const,
    right: 16,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: Tokens.radius.full,
    backgroundColor: Colors.primary,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 4,
  },
  fabText: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '800' as const,
    color: Colors.background,
  },

  // Modal
  modalRoot: { flex: 1, backgroundColor: Colors.background },
  modalHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  modalClose: { padding: 4 },
  modalTitle: { fontSize: Type.subheadline.fontSize, fontWeight: '800' as const, color: Colors.text },
  modalSave: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: Tokens.radius.full,
    backgroundColor: Colors.primary,
  },
  modalSaveText: { fontSize: Type.footnote.fontSize, fontWeight: '800' as const, color: Colors.background },
  modalBody: { padding: 16, gap: 6, paddingBottom: 60 },

  label: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '700' as const,
    color: Colors.textMuted,
    letterSpacing: 0.3,
    textTransform: 'uppercase' as const,
    marginTop: 14,
    marginBottom: 6,
  },
  field: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    backgroundColor: Colors.surface,
    borderRadius: Tokens.radius.md,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  fieldText: { fontSize: Type.body.fontSize, color: Colors.text, fontWeight: '600' as const, flex: 1 },
  fieldPlaceholder: { color: Colors.textMuted, fontWeight: '500' as const },
  pickerList: {
    backgroundColor: Colors.surface,
    borderRadius: Tokens.radius.md,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    marginTop: 6,
    overflow: 'hidden' as const,
  },
  pickerItem: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.borderLight,
  },
  pickerItemText: { fontSize: Type.body.fontSize, color: Colors.text, fontWeight: '500' as const },

  modeRow: { flexDirection: 'row' as const, gap: 10 },
  modeBtn: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: Tokens.radius.md,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    backgroundColor: Colors.surface,
  },
  modeBtnActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary + '10',
  },
  modeBtnText: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '900' as const,
    color: Colors.text,
    letterSpacing: 0.4,
  },
  modeBtnTextActive: { color: Colors.primary },
  modeBtnSub: {
    fontSize: Type.caption2.fontSize,
    color: Colors.textMuted,
    marginTop: 2,
  },

  input: {
    backgroundColor: Colors.surface,
    borderRadius: Tokens.radius.md,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 12 : 10,
    fontSize: Type.body.fontSize,
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  helperText: {
    marginTop: 16,
    fontSize: Type.caption2.fontSize,
    color: Colors.textMuted,
    fontStyle: 'italic' as const,
  },
});
