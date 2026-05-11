// delivery-receipts.tsx — cross-project Delivery Receipt log + entry.
//
// Pre-fix: deliveries were a `materialsDelivered: string[]` blob on
// each Daily Field Report. The super audit flagged this as a
// discovery deal-breaker for material-heavy residential GCs vs.
// Procore / Buildertrend / Raken. The hook + table now exist
// (useDeliveryReceipts, supabase/migrations/create_delivery_receipts.sql);
// this screen is the surface that closes the loop:
//
//   - Cross-project rollup: every delivery on every project the GC
//     owns, sortable by date. Super on Project A can scan what
//     dropped on Project B yesterday without leaving home.
//   - Project filter chips when there are multiple projects active.
//   - Damage badge front-and-center — the damaged-delivery follow-up
//     loop is the highest-value workflow this enables (supplier
//     credit, schedule slip, owner CO).
//   - "+ Add delivery" → minimal capture flow: project, supplier,
//     date, item lines, BOL photo, damage flag, notes. Receipt
//     auto-stamps `receivedAt = now` and `receivedBy` from the user
//     profile. No multi-step wizard — supers don't have time for
//     that on the back of a truck.
//
// Photo capture uses expo-image-picker (camera or library), same
// pattern as coi-vault and daily-report.

import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Modal, TextInput, Alert, Platform, RefreshControl, KeyboardAvoidingView,
} from 'react-native';
// expo-image: BOL thumbnails on the list view + the full-size BOL
// preview in the edit modal. The list can hold a few dozen receipts
// at once; expo-image's caching helps the gallery scroll smoothly.
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import {
  Plus, Truck, AlertTriangle, Camera, X, ChevronDown, Trash2,
  PackageCheck, Image as ImageIcon, FileText, Check, ChevronRight,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { useDeliveryReceipts } from '@/hooks/useDeliveryReceipts';
import { useAuth } from '@/contexts/AuthContext';
import { generateUUID } from '@/utils/generateId';
import EmptyState from '@/components/ui/EmptyState';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import type { DeliveryReceipt, DeliveryReceiptItem } from '@/types';

function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function dateLabel(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function DeliveryReceiptsScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ projectId?: string }>();
  const { user } = useAuth();
  const { projects } = useProjects();
  const { receipts, addReceipt, updateReceipt, deleteReceipt, loading } = useDeliveryReceipts();

  // Default project filter — when launched from a project's tile we
  // pre-select that project; otherwise show all.
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    typeof params.projectId === 'string' ? params.projectId : null,
  );

  const [composerOpen, setComposerOpen] = useState(false);
  const [editingReceipt, setEditingReceipt] = useState<DeliveryReceipt | null>(null);

  const projectName = useMemo(
    () => new Map(projects.map(p => [p.id, p.name])),
    [projects],
  );

  const filtered = useMemo(() => {
    const sorted = [...receipts].sort((a, b) =>
      Date.parse(b.date) - Date.parse(a.date) || Date.parse(b.receivedAt) - Date.parse(a.receivedAt),
    );
    if (!selectedProjectId) return sorted;
    return sorted.filter(r => r.projectId === selectedProjectId);
  }, [receipts, selectedProjectId]);

  const damagedCount = useMemo(
    () => filtered.filter(r => r.hasDamage).length,
    [filtered],
  );

  const projectsWithDeliveries = useMemo(() => {
    const ids = new Set(receipts.map(r => r.projectId));
    return projects.filter(p => ids.has(p.id));
  }, [receipts, projects]);

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: 'Deliveries',
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.primary,
          headerTitleStyle: { fontWeight: '700' as const, color: Colors.text },
        }}
      />

      <ScrollView
        contentContainerStyle={{ paddingTop: Tokens.spacing.sm, paddingBottom: insets.bottom + 88 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={false}
            onRefresh={() => { /* hook auto-pulls on auth */ }}
          />
        }
      >
        {/* Header */}
        <View style={styles.headerRow}>
          <Text style={styles.headerTitle}>Deliveries</Text>
          <Text style={styles.headerCount}>{filtered.length}</Text>
        </View>
        <Text style={styles.headerSub}>
          {filtered.length === 0
            ? 'No deliveries logged yet'
            : `${filtered.length} delivery${filtered.length === 1 ? '' : ' receipts'}${damagedCount > 0 ? ` · ${damagedCount} flagged for damage` : ''}`}
        </Text>

        {/* Project filter chips */}
        {projectsWithDeliveries.length > 1 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipRow}
          >
            <TouchableOpacity
              onPress={() => setSelectedProjectId(null)}
              style={[styles.chip, !selectedProjectId && styles.chipActive]}
              activeOpacity={0.85}
              testID="delivery-filter-all"
            >
              <Text style={[styles.chipText, !selectedProjectId && styles.chipTextActive]}>
                All ({receipts.length})
              </Text>
            </TouchableOpacity>
            {projectsWithDeliveries.map(p => {
              const count = receipts.filter(r => r.projectId === p.id).length;
              const active = selectedProjectId === p.id;
              return (
                <TouchableOpacity
                  key={p.id}
                  onPress={() => setSelectedProjectId(p.id)}
                  style={[styles.chip, active && styles.chipActive]}
                  activeOpacity={0.85}
                  testID={`delivery-filter-${p.id}`}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>
                    {p.name} ({count})
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}

        {/* List */}
        {loading ? (
          <View style={{ paddingTop: Tokens.spacing['3xl'] }}>
            <Text style={styles.subEmptyText}>Loading…</Text>
          </View>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Truck size={36} color={Colors.primary} strokeWidth={1.6} />}
            title="No deliveries logged"
            message="Tap + below to log a delivery the next time a truck rolls in. Capture the BOL, mark damage if any, and the GC sees a clean rollup across every project."
          />
        ) : (
          filtered.map(r => (
            <TouchableOpacity
              key={r.id}
              style={styles.card}
              activeOpacity={0.85}
              onPress={() => setEditingReceipt(r)}
              testID={`delivery-${r.id}`}
            >
              <View style={styles.cardBody}>
                <View
                  style={[
                    styles.cardIconWrap,
                    { backgroundColor: (r.hasDamage ? Colors.error : Colors.primary) + '15' },
                  ]}
                >
                  {r.hasDamage ? (
                    <AlertTriangle size={16} color={Colors.error} />
                  ) : (
                    <PackageCheck size={16} color={Colors.primary} />
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardProject} numberOfLines={1}>
                    {projectName.get(r.projectId) ?? 'Unknown project'}
                  </Text>
                  <Text style={styles.cardTitle} numberOfLines={1}>
                    {r.supplier}
                  </Text>
                  <Text style={styles.cardSub} numberOfLines={1}>
                    {dateLabel(r.date)}
                    {r.poNumber ? ` · PO ${r.poNumber}` : ''}
                    {r.items.length > 0 ? ` · ${r.items.length} item${r.items.length === 1 ? '' : 's'}` : ''}
                  </Text>
                  {r.hasDamage && r.damageNotes ? (
                    <Text style={styles.damageText} numberOfLines={2}>
                      Damage: {r.damageNotes}
                    </Text>
                  ) : null}
                </View>
                {r.bolPhotoUri ? (
                  <Image source={{ uri: r.bolPhotoUri }} style={styles.thumb} />
                ) : (
                  <ChevronRight size={16} color={Colors.textMuted} />
                )}
              </View>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>

      {/* Floating add button */}
      <TouchableOpacity
        style={[styles.fab, { bottom: insets.bottom + 16 }]}
        activeOpacity={0.85}
        onPress={() => {
          if (Platform.OS !== 'web') void Haptics.selectionAsync().catch(() => {});
          setComposerOpen(true);
        }}
        accessibilityRole="button"
        accessibilityLabel="Add delivery"
        testID="delivery-add"
      >
        <Plus size={20} color={Colors.background} />
        <Text style={styles.fabText}>Add delivery</Text>
      </TouchableOpacity>

      {/* Composer modal */}
      <DeliveryComposerModal
        visible={composerOpen}
        defaultProjectId={selectedProjectId ?? undefined}
        userName={user?.name ?? 'Super'}
        projects={projects}
        onClose={() => setComposerOpen(false)}
        onSave={(input) => {
          addReceipt(input);
          setComposerOpen(false);
          if (Platform.OS !== 'web') {
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          }
        }}
      />

      {/* Edit modal */}
      <DeliveryEditModal
        receipt={editingReceipt}
        projectName={projectName.get(editingReceipt?.projectId ?? '') ?? ''}
        onClose={() => setEditingReceipt(null)}
        onSave={(id, patch) => {
          updateReceipt(id, patch);
          setEditingReceipt(null);
        }}
        onDelete={(id) => {
          Alert.alert(
            'Delete delivery receipt',
            'Remove this record? This can\'t be undone.',
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Delete',
                style: 'destructive',
                onPress: () => {
                  deleteReceipt(id);
                  setEditingReceipt(null);
                },
              },
            ],
          );
        }}
      />

    </View>
  );
}

// ─── Composer modal ─────────────────────────────────────────────
//
// Minimal form with the fields a super on the back of a truck can
// fill in 30s: project, supplier, date (defaults to today), items
// (single textfield each), BOL photo, damage flag, notes.
function DeliveryComposerModal({
  visible, defaultProjectId, userName, projects, onClose, onSave,
}: {
  visible: boolean;
  defaultProjectId?: string;
  userName: string;
  projects: ReturnType<typeof useProjects>['projects'];
  onClose: () => void;
  onSave: (input: Omit<DeliveryReceipt, 'id' | 'createdAt' | 'updatedAt'>) => void;
}) {
  const [projectId, setProjectId] = useState<string | null>(defaultProjectId ?? null);
  const [supplier, setSupplier] = useState('');
  const [poNumber, setPoNumber] = useState('');
  const [date, setDate] = useState(todayISO());
  const [items, setItems] = useState<{ id: string; name: string; qty: string; unit: string }[]>([
    { id: generateUUID(), name: '', qty: '', unit: 'ea' },
  ]);
  const [bolUri, setBolUri] = useState<string | null>(null);
  const [hasDamage, setHasDamage] = useState(false);
  const [damageNotes, setDamageNotes] = useState('');
  const [notes, setNotes] = useState('');
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);

  const reset = useCallback(() => {
    setProjectId(defaultProjectId ?? null);
    setSupplier('');
    setPoNumber('');
    setDate(todayISO());
    setItems([{ id: generateUUID(), name: '', qty: '', unit: 'ea' }]);
    setBolUri(null);
    setHasDamage(false);
    setDamageNotes('');
    setNotes('');
  }, [defaultProjectId]);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  const pickPhoto = useCallback(async (source: 'camera' | 'library') => {
    try {
      const perm = source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission needed', 'Grant access to your camera or library to capture the BOL photo.');
        return;
      }
      const result = source === 'camera'
        ? await ImagePicker.launchCameraAsync({ quality: 0.85 })
        : await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            quality: 0.85,
          });
      if (result.canceled || !result.assets[0]) return;
      setBolUri(result.assets[0].uri);
    } catch (err) {
      console.warn('[delivery-receipts] photo pick failed', err);
    }
  }, []);

  const handleSave = useCallback(() => {
    if (!projectId) {
      Alert.alert('Pick a project', 'Choose which project this delivery is for.');
      return;
    }
    if (!supplier.trim()) {
      Alert.alert('Supplier required', 'Enter the supplier name (Lowes, ABC Lumber, etc).');
      return;
    }
    const cleanItems: DeliveryReceiptItem[] = items
      .filter(i => i.name.trim())
      .map(i => ({
        id: i.id,
        name: i.name.trim(),
        qtyReceived: Number(i.qty) || 0,
        unit: i.unit.trim() || 'ea',
      }));
    onSave({
      projectId,
      date,
      supplier: supplier.trim(),
      poNumber: poNumber.trim() || undefined,
      items: cleanItems,
      bolPhotoUri: bolUri ?? undefined,
      hasDamage,
      damageNotes: hasDamage ? (damageNotes.trim() || undefined) : undefined,
      receivedAt: new Date().toISOString(),
      receivedBy: userName,
      notes: notes.trim() || undefined,
    });
    reset();
  }, [projectId, supplier, poNumber, date, items, bolUri, hasDamage, damageNotes, notes, userName, onSave, reset]);

  const selectedProject = projects.find(p => p.id === projectId);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        style={styles.modalRoot}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.modalHeader}>
          <TouchableOpacity onPress={handleClose} style={styles.modalClose}>
            <X size={20} color={Colors.text} />
          </TouchableOpacity>
          <Text style={styles.modalTitle}>New delivery</Text>
          <TouchableOpacity onPress={handleSave} style={styles.modalSave} testID="delivery-save">
            <Check size={18} color={Colors.background} />
            <Text style={styles.modalSaveText}>Save</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.modalBody} showsVerticalScrollIndicator={false}>
          {/* Project picker */}
          <Text style={styles.label}>Project</Text>
          <TouchableOpacity
            style={styles.field}
            onPress={() => setProjectPickerOpen(o => !o)}
            activeOpacity={0.85}
            testID="delivery-project-picker"
          >
            <Text style={[styles.fieldText, !selectedProject && styles.fieldPlaceholder]}>
              {selectedProject?.name ?? 'Pick a project'}
            </Text>
            <ChevronDown size={16} color={Colors.textMuted} />
          </TouchableOpacity>
          {projectPickerOpen && (
            <View style={styles.pickerList}>
              {projects.map(p => (
                <TouchableOpacity
                  key={p.id}
                  style={styles.pickerItem}
                  onPress={() => {
                    setProjectId(p.id);
                    setProjectPickerOpen(false);
                  }}
                >
                  <Text style={styles.pickerItemText}>{p.name}</Text>
                  {p.id === projectId ? <Check size={14} color={Colors.primary} /> : null}
                </TouchableOpacity>
              ))}
            </View>
          )}

          <Text style={styles.label}>Supplier</Text>
          <TextInput
            value={supplier}
            onChangeText={setSupplier}
            placeholder="ABC Lumber, Lowes, Home Depot..."
            placeholderTextColor={Colors.textMuted}
            style={styles.input}
            testID="delivery-supplier"
          />

          <View style={{ flexDirection: 'row' as const, gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Date</Text>
              <TextInput
                value={date}
                onChangeText={setDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={Colors.textMuted}
                style={styles.input}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>PO # (optional)</Text>
              <TextInput
                value={poNumber}
                onChangeText={setPoNumber}
                placeholder="PO-1234"
                placeholderTextColor={Colors.textMuted}
                style={styles.input}
              />
            </View>
          </View>

          {/* Item lines */}
          <View style={styles.itemHeaderRow}>
            <Text style={styles.label}>Items</Text>
            <TouchableOpacity
              onPress={() => setItems(prev => [...prev, { id: generateUUID(), name: '', qty: '', unit: 'ea' }])}
              style={styles.addRowBtn}
              testID="delivery-add-item"
            >
              <Plus size={12} color={Colors.primary} />
              <Text style={styles.addRowBtnText}>Add line</Text>
            </TouchableOpacity>
          </View>
          {items.map((item, idx) => (
            <View key={item.id} style={styles.itemRow}>
              <TextInput
                value={item.name}
                onChangeText={(t) => setItems(prev => prev.map(i => i.id === item.id ? { ...i, name: t } : i))}
                placeholder={`Item ${idx + 1} (e.g. 1/2" drywall)`}
                placeholderTextColor={Colors.textMuted}
                style={[styles.input, styles.itemInputName]}
              />
              <TextInput
                value={item.qty}
                onChangeText={(t) => setItems(prev => prev.map(i => i.id === item.id ? { ...i, qty: t } : i))}
                placeholder="Qty"
                placeholderTextColor={Colors.textMuted}
                keyboardType="numeric"
                style={[styles.input, styles.itemInputQty]}
              />
              <TextInput
                value={item.unit}
                onChangeText={(t) => setItems(prev => prev.map(i => i.id === item.id ? { ...i, unit: t } : i))}
                placeholder="ea"
                placeholderTextColor={Colors.textMuted}
                style={[styles.input, styles.itemInputUnit]}
              />
              {items.length > 1 && (
                <TouchableOpacity
                  onPress={() => setItems(prev => prev.filter(i => i.id !== item.id))}
                  style={styles.itemRemoveBtn}
                >
                  <Trash2 size={14} color={Colors.error} />
                </TouchableOpacity>
              )}
            </View>
          ))}

          {/* BOL photo */}
          <Text style={styles.label}>BOL photo</Text>
          {bolUri ? (
            <View style={styles.bolPreviewWrap}>
              <Image source={{ uri: bolUri }} style={styles.bolPreview} />
              <TouchableOpacity
                onPress={() => setBolUri(null)}
                style={styles.bolRemove}
              >
                <X size={14} color={Colors.background} />
              </TouchableOpacity>
            </View>
          ) : (
            <View style={{ flexDirection: 'row' as const, gap: Tokens.spacing.xs }}>
              <TouchableOpacity
                onPress={() => pickPhoto('camera')}
                style={styles.photoBtn}
                activeOpacity={0.85}
                testID="delivery-bol-camera"
              >
                <Camera size={16} color={Colors.text} />
                <Text style={styles.photoBtnText}>Camera</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => pickPhoto('library')}
                style={styles.photoBtn}
                activeOpacity={0.85}
                testID="delivery-bol-library"
              >
                <ImageIcon size={16} color={Colors.text} />
                <Text style={styles.photoBtnText}>Library</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Damage toggle */}
          <TouchableOpacity
            onPress={() => setHasDamage(v => !v)}
            style={[styles.damageToggle, hasDamage && styles.damageToggleOn]}
            activeOpacity={0.85}
            testID="delivery-damage-toggle"
          >
            <AlertTriangle size={16} color={hasDamage ? Colors.error : Colors.textMuted} />
            <Text style={[styles.damageToggleText, hasDamage && { color: Colors.error }]}>
              {hasDamage ? 'Damage / shortage flagged' : 'No damage'}
            </Text>
          </TouchableOpacity>
          {hasDamage && (
            <TextInput
              value={damageNotes}
              onChangeText={setDamageNotes}
              placeholder="What was damaged or short? Drives the supplier credit."
              placeholderTextColor={Colors.textMuted}
              multiline
              style={[styles.input, styles.multilineInput]}
            />
          )}

          <Text style={styles.label}>Notes (optional)</Text>
          <TextInput
            value={notes}
            onChangeText={setNotes}
            placeholder="Driver name, gate code, where stored on site..."
            placeholderTextColor={Colors.textMuted}
            multiline
            style={[styles.input, styles.multilineInput]}
          />

          <Text style={styles.helperText}>
            Receipt will be saved as received now by {userName}.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Edit modal ─────────────────────────────────────────────
function DeliveryEditModal({
  receipt, projectName, onClose, onSave, onDelete,
}: {
  receipt: DeliveryReceipt | null;
  projectName: string;
  onClose: () => void;
  onSave: (id: string, patch: Partial<DeliveryReceipt>) => void;
  onDelete: (id: string) => void;
}) {
  const [hasDamage, setHasDamage] = useState(false);
  const [damageNotes, setDamageNotes] = useState('');
  const [notes, setNotes] = useState('');

  React.useEffect(() => {
    if (receipt) {
      setHasDamage(receipt.hasDamage);
      setDamageNotes(receipt.damageNotes ?? '');
      setNotes(receipt.notes ?? '');
    }
  }, [receipt]);

  if (!receipt) return null;

  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.modalRoot}>
        <View style={styles.modalHeader}>
          <TouchableOpacity onPress={onClose} style={styles.modalClose}>
            <X size={20} color={Colors.text} />
          </TouchableOpacity>
          <Text style={styles.modalTitle}>Delivery details</Text>
          <TouchableOpacity
            onPress={() => onSave(receipt.id, {
              hasDamage,
              damageNotes: hasDamage ? (damageNotes.trim() || undefined) : undefined,
              notes: notes.trim() || undefined,
            })}
            style={styles.modalSave}
          >
            <Check size={18} color={Colors.background} />
            <Text style={styles.modalSaveText}>Save</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.modalBody}>
          <View style={styles.detailHeaderCard}>
            <Text style={styles.detailProject}>{projectName}</Text>
            <Text style={styles.detailSupplier}>{receipt.supplier}</Text>
            <Text style={styles.detailMeta}>
              {dateLabel(receipt.date)}
              {receipt.poNumber ? ` · PO ${receipt.poNumber}` : ''}
            </Text>
            <Text style={styles.detailMetaSmall}>
              Received by {receipt.receivedBy} on {dateLabel(receipt.receivedAt)}
            </Text>
          </View>

          {receipt.bolPhotoUri ? (
            <>
              <Text style={styles.label}>BOL photo</Text>
              <Image source={{ uri: receipt.bolPhotoUri }} style={styles.detailPhoto} />
            </>
          ) : null}

          {receipt.items.length > 0 ? (
            <>
              <Text style={styles.label}>Items ({receipt.items.length})</Text>
              <View style={styles.itemList}>
                {receipt.items.map(item => (
                  <View key={item.id} style={styles.itemListRow}>
                    <FileText size={12} color={Colors.textMuted} />
                    <Text style={styles.itemListText} numberOfLines={2}>
                      {item.qtyReceived} {item.unit} · {item.name}
                    </Text>
                  </View>
                ))}
              </View>
            </>
          ) : null}

          <TouchableOpacity
            onPress={() => setHasDamage(v => !v)}
            style={[styles.damageToggle, hasDamage && styles.damageToggleOn]}
            activeOpacity={0.85}
          >
            <AlertTriangle size={16} color={hasDamage ? Colors.error : Colors.textMuted} />
            <Text style={[styles.damageToggleText, hasDamage && { color: Colors.error }]}>
              {hasDamage ? 'Damage / shortage flagged' : 'No damage'}
            </Text>
          </TouchableOpacity>
          {hasDamage && (
            <TextInput
              value={damageNotes}
              onChangeText={setDamageNotes}
              placeholder="What was damaged?"
              placeholderTextColor={Colors.textMuted}
              multiline
              style={[styles.input, styles.multilineInput]}
            />
          )}

          <Text style={styles.label}>Notes</Text>
          <TextInput
            value={notes}
            onChangeText={setNotes}
            multiline
            placeholder="Notes on the delivery"
            placeholderTextColor={Colors.textMuted}
            style={[styles.input, styles.multilineInput]}
          />

          <TouchableOpacity
            style={styles.deleteBtn}
            onPress={() => onDelete(receipt.id)}
            activeOpacity={0.85}
          >
            <Trash2 size={14} color={Colors.error} />
            <Text style={styles.deleteBtnText}>Delete receipt</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

  headerRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingHorizontal: Tokens.spacing.md,
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
    paddingHorizontal: Tokens.spacing.md,
    fontSize: Type.footnote.fontSize,
    color: Colors.textMuted,
    marginBottom: Tokens.spacing.sm,
  },

  chipRow: { flexDirection: 'row' as const, gap: Tokens.spacing.xs, paddingHorizontal: Tokens.spacing.md, marginBottom: Tokens.spacing.sm },
  chip: {
    paddingHorizontal: Tokens.spacing.sm,
    paddingVertical: 7,
    borderRadius: Tokens.radius.full,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    backgroundColor: Colors.surface,
    maxWidth: 220,
  },
  chipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: Colors.textSecondary },
  chipTextActive: { color: Colors.background },

  card: {
    backgroundColor: Colors.surface,
    borderRadius: Tokens.radius.lg,
    marginHorizontal: Tokens.spacing.md,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    overflow: 'hidden' as const,
  },
  cardBody: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: Tokens.spacing.sm, padding: Tokens.spacing.sm },
  cardIconWrap: {
    width: 32, height: 32,
    borderRadius: Tokens.radius.sm,
    alignItems: 'center' as const, justifyContent: 'center' as const,
  },
  cardProject: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '700' as const,
    color: Colors.textMuted,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.4,
  },
  cardTitle: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: Colors.text, marginTop: Tokens.spacing.hairline },
  cardSub: { fontSize: Type.caption1.fontSize, color: Colors.textSecondary, marginTop: Tokens.spacing.hairline },
  damageText: {
    fontSize: Type.caption2.fontSize,
    color: Colors.error,
    marginTop: Tokens.spacing.xxs,
    fontWeight: '600' as const,
  },
  thumb: { width: 48, height: 48, borderRadius: Tokens.radius.sm, backgroundColor: Colors.fillTertiary },

  fab: {
    position: 'absolute' as const,
    right: 16,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    paddingHorizontal: Tokens.spacing.md,
    paddingVertical: Tokens.spacing.sm,
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
    paddingHorizontal: Tokens.spacing.md,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  modalClose: { padding: Tokens.spacing.xxs },
  modalTitle: { fontSize: Type.subheadline.fontSize, fontWeight: '800' as const, color: Colors.text },
  modalSave: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: Tokens.spacing.xxs,
    paddingHorizontal: Tokens.spacing.sm,
    paddingVertical: 7,
    borderRadius: Tokens.radius.full,
    backgroundColor: Colors.primary,
  },
  modalSaveText: { fontSize: Type.footnote.fontSize, fontWeight: '800' as const, color: Colors.background },
  modalBody: { padding: Tokens.spacing.md, gap: 6, paddingBottom: 60 },

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
    paddingHorizontal: Tokens.spacing.sm,
    paddingVertical: Tokens.spacing.sm,
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
    paddingVertical: Tokens.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.borderLight,
  },
  pickerItemText: { fontSize: Type.body.fontSize, color: Colors.text, fontWeight: '500' as const },

  input: {
    backgroundColor: Colors.surface,
    borderRadius: Tokens.radius.md,
    paddingHorizontal: Tokens.spacing.sm,
    paddingVertical: Platform.OS === 'ios' ? 12 : 10,
    fontSize: Type.body.fontSize,
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  multilineInput: { minHeight: 70, textAlignVertical: 'top' as const, paddingTop: 10 },

  itemHeaderRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    marginTop: 14,
    marginBottom: 6,
  },
  addRowBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: Tokens.spacing.xxs,
    paddingHorizontal: Tokens.spacing.xs,
    paddingVertical: Tokens.spacing.xxs,
    borderRadius: Tokens.radius.full,
    backgroundColor: Colors.primary + '15',
  },
  addRowBtnText: { fontSize: Type.caption1.fontSize, fontWeight: '700' as const, color: Colors.primary },

  itemRow: { flexDirection: 'row' as const, gap: 6, alignItems: 'center' as const, marginBottom: 6 },
  itemInputName: { flex: 2 },
  itemInputQty: { flex: 0.7, textAlign: 'right' as const },
  itemInputUnit: { flex: 0.6, textAlign: 'center' as const },
  itemRemoveBtn: { padding: 6 },

  bolPreviewWrap: { position: 'relative' as const },
  bolPreview: {
    width: '100%',
    height: 200,
    borderRadius: Tokens.radius.md,
    backgroundColor: Colors.fillTertiary,
  },
  bolRemove: {
    position: 'absolute' as const,
    top: 8, right: 8,
    padding: 6,
    borderRadius: Tokens.radius.full,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  photoBtn: {
    flex: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 6,
    paddingVertical: 14,
    borderRadius: Tokens.radius.md,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    backgroundColor: Colors.surface,
  },
  photoBtnText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: Colors.text },

  damageToggle: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: Tokens.spacing.xs,
    paddingHorizontal: Tokens.spacing.sm,
    paddingVertical: Tokens.spacing.sm,
    borderRadius: Tokens.radius.md,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    backgroundColor: Colors.surface,
    marginTop: 14,
  },
  damageToggleOn: {
    borderColor: Colors.error,
    backgroundColor: Colors.error + '08',
  },
  damageToggleText: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '700' as const,
    color: Colors.textMuted,
  },

  helperText: {
    marginTop: Tokens.spacing.md,
    fontSize: Type.caption2.fontSize,
    color: Colors.textMuted,
    fontStyle: 'italic' as const,
  },

  detailHeaderCard: {
    backgroundColor: Colors.surface,
    borderRadius: Tokens.radius.lg,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    marginBottom: 6,
  },
  detailProject: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '700' as const,
    color: Colors.textMuted,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.4,
  },
  detailSupplier: {
    fontSize: Type.title3.fontSize,
    fontWeight: '800' as const,
    color: Colors.text,
    marginTop: Tokens.spacing.xxs,
  },
  detailMeta: { fontSize: Type.body.fontSize, color: Colors.textSecondary, marginTop: Tokens.spacing.xxs },
  detailMetaSmall: { fontSize: Type.caption1.fontSize, color: Colors.textMuted, marginTop: Tokens.spacing.xxs },

  detailPhoto: {
    width: '100%',
    height: 200,
    borderRadius: Tokens.radius.md,
    backgroundColor: Colors.fillTertiary,
  },
  itemList: {
    backgroundColor: Colors.surface,
    borderRadius: Tokens.radius.md,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    overflow: 'hidden' as const,
  },
  itemListRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: Tokens.spacing.xs,
    paddingHorizontal: Tokens.spacing.sm,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.borderLight,
  },
  itemListText: {
    fontSize: Type.bodyCompact.fontSize,
    color: Colors.text,
    flex: 1,
  },

  deleteBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 6,
    paddingVertical: 14,
    marginTop: Tokens.spacing.xl,
    borderRadius: Tokens.radius.md,
    borderWidth: 1,
    borderColor: Colors.error,
    backgroundColor: Colors.error + '08',
  },
  deleteBtnText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: Colors.error },

  subEmptyText: {
    fontSize: Type.body.fontSize,
    color: Colors.textMuted,
    textAlign: 'center' as const,
  },
});
