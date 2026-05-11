// licenses.tsx — vision-doc #19 extension. Track every license the
// GC needs current to pull permits + bill clients legally.
//
// One missed renewal = can't pull permits = entire schedule slips.
// This screen lists the GC's licenses with expiry status front-and-
// center. The compliance-hub aggregates the count alongside COIs +
// permits.

import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal,
  TextInput, Alert, Platform, KeyboardAvoidingView,
} from 'react-native';
import { Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  Plus, FileBadge, AlertTriangle, CheckCircle2, X, Check, Trash2,
  ChevronDown, Calendar, MapPin, Hash,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import {
  useContractorLicenses, type ContractorLicense, type LicenseType,
} from '@/hooks/useContractorLicenses';
import EmptyState from '@/components/ui/EmptyState';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

const LICENSE_TYPES: { key: LicenseType; label: string }[] = [
  { key: 'gc', label: 'General Contractor' },
  { key: 'state_contractor', label: 'State Contractor License' },
  { key: 'home_improvement', label: 'Home Improvement Contractor' },
  { key: 'electrical', label: 'Master Electrician' },
  { key: 'plumbing', label: 'Master Plumber' },
  { key: 'mechanical', label: 'Mechanical / HVAC' },
  { key: 'lipa', label: 'LIPA Registration' },
  { key: 'asbestos', label: 'Asbestos Handler' },
  { key: 'lead_paint', label: 'EPA RRP Lead Paint' },
  { key: 'other', label: 'Other' },
];

function labelForType(t: LicenseType): string {
  return LICENSE_TYPES.find(x => x.key === t)?.label ?? t;
}

function dateLabel(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function daysUntil(iso: string): number {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return Infinity;
  return Math.round((t - Date.now()) / 86_400_000);
}

function statusFor(daysToExpiry: number): { label: string; tint: string } {
  if (daysToExpiry < 0) return { label: `Expired ${Math.abs(daysToExpiry)}d ago`, tint: Colors.error };
  if (daysToExpiry === 0) return { label: 'Expires today', tint: Colors.error };
  if (daysToExpiry <= 14) return { label: `Expires in ${daysToExpiry}d`, tint: Colors.warning };
  if (daysToExpiry <= 60) return { label: `Expires in ${daysToExpiry}d`, tint: Colors.info };
  return { label: `Expires in ${daysToExpiry}d`, tint: Colors.success };
}

export default function LicensesScreen() {
  const insets = useSafeAreaInsets();
  const { licenses, addLicense, updateLicense, deleteLicense, loading } = useContractorLicenses();
  const [composerOpen, setComposerOpen] = useState(false);
  const [editing, setEditing] = useState<ContractorLicense | null>(null);

  const sorted = useMemo(() =>
    [...licenses].sort((a, b) => Date.parse(a.expiresDate) - Date.parse(b.expiresDate)),
    [licenses],
  );

  const expiringCount = useMemo(
    () => licenses.filter(l => daysUntil(l.expiresDate) <= 60).length,
    [licenses],
  );

  const handleDelete = useCallback((l: ContractorLicense) => {
    Alert.alert(
      'Delete license',
      `Remove "${l.name}"? Historical permits keep referencing it; this only removes the tracking record.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => deleteLicense(l.id) },
      ],
    );
  }, [deleteLicense]);

  if (!loading && licenses.length === 0) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ title: 'Licenses' }} />
        <EmptyState
          icon={<FileBadge size={36} color={Colors.primary} strokeWidth={1.6} />}
          title="No licenses tracked yet"
          message="Track your DCWP / state contractor / Home Improvement / electrical / plumbing licenses. We'll alert you 60 / 30 / 14 / 3 days before expiry."
        />
        <TouchableOpacity
          style={[styles.fab, { bottom: insets.bottom + 16 }]}
          activeOpacity={0.85}
          onPress={() => setComposerOpen(true)}
          accessibilityRole="button"
        >
          <Plus size={20} color={Colors.background} />
          <Text style={styles.fabText}>Add license</Text>
        </TouchableOpacity>
        <LicenseComposerModal
          visible={composerOpen}
          editing={null}
          onClose={() => setComposerOpen(false)}
          onSave={(input) => { addLicense(input); setComposerOpen(false); }}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: 'Licenses',
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.primary,
          headerTitleStyle: { fontWeight: '700' as const, color: Colors.text },
        }}
      />
      <ScrollView contentContainerStyle={{ paddingTop: Tokens.spacing.sm, paddingBottom: insets.bottom + 88 }}>
        <View style={styles.headerRow}>
          <Text style={styles.headerTitle}>Licenses</Text>
          <Text style={styles.headerCount}>{licenses.length}</Text>
        </View>
        <Text style={styles.headerSub}>
          {expiringCount > 0
            ? `${expiringCount} expiring within 60 days`
            : 'All current — no expirations in next 60 days'}
        </Text>

        {sorted.map(l => {
          const days = daysUntil(l.expiresDate);
          const status = statusFor(days);
          const overdue = days < 0;
          return (
            <TouchableOpacity
              key={l.id}
              style={[
                styles.card,
                overdue && { borderColor: Colors.error + '60', backgroundColor: Colors.error + '06' },
              ]}
              activeOpacity={0.85}
              onPress={() => setEditing(l)}
            >
              <View style={[styles.iconWrap, { backgroundColor: status.tint + '15' }]}>
                {overdue
                  ? <AlertTriangle size={16} color={status.tint} />
                  : days <= 14 ? <AlertTriangle size={16} color={status.tint} />
                  : <CheckCircle2 size={16} color={status.tint} />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle} numberOfLines={1}>{l.name}</Text>
                <Text style={styles.cardSub} numberOfLines={1}>
                  {labelForType(l.licenseType)} · {l.jurisdiction}
                </Text>
                <View style={styles.metaRow}>
                  {l.licenseNumber && (
                    <View style={styles.metaPill}>
                      <Hash size={10} color={Colors.textMuted} />
                      <Text style={styles.metaText}>{l.licenseNumber}</Text>
                    </View>
                  )}
                  <View style={styles.metaPill}>
                    <Calendar size={10} color={status.tint} />
                    <Text style={[styles.metaText, { color: status.tint }]}>
                      {status.label}
                    </Text>
                  </View>
                </View>
              </View>
              <TouchableOpacity onPress={() => handleDelete(l)} style={styles.trashBtn}>
                <Trash2 size={14} color={Colors.textMuted} />
              </TouchableOpacity>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <TouchableOpacity
        style={[styles.fab, { bottom: insets.bottom + 16 }]}
        activeOpacity={0.85}
        onPress={() => setComposerOpen(true)}
        accessibilityRole="button"
      >
        <Plus size={20} color={Colors.background} />
        <Text style={styles.fabText}>Add license</Text>
      </TouchableOpacity>

      <LicenseComposerModal
        visible={composerOpen || !!editing}
        editing={editing}
        onClose={() => { setComposerOpen(false); setEditing(null); }}
        onSave={(input) => {
          if (editing) {
            updateLicense(editing.id, input);
            setEditing(null);
          } else {
            addLicense(input);
            setComposerOpen(false);
          }
          if (Platform.OS !== 'web') {
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          }
        }}
      />
    </View>
  );
}

// ─── Composer modal ─────────────────────────────────────────────
function LicenseComposerModal({
  visible, editing, onClose, onSave,
}: {
  visible: boolean;
  editing: ContractorLicense | null;
  onClose: () => void;
  onSave: (input: Omit<ContractorLicense, 'id' | 'createdAt' | 'updatedAt'>) => void;
}) {
  const [name, setName] = useState('');
  const [licenseNumber, setLicenseNumber] = useState('');
  const [licenseType, setLicenseType] = useState<LicenseType>('gc');
  const [jurisdiction, setJurisdiction] = useState('');
  const [issuedDate, setIssuedDate] = useState('');
  const [expiresDate, setExpiresDate] = useState('');
  const [notes, setNotes] = useState('');
  const [typePickerOpen, setTypePickerOpen] = useState(false);

  React.useEffect(() => {
    if (visible) {
      setName(editing?.name ?? '');
      setLicenseNumber(editing?.licenseNumber ?? '');
      setLicenseType(editing?.licenseType ?? 'gc');
      setJurisdiction(editing?.jurisdiction ?? '');
      setIssuedDate(editing?.issuedDate ? editing.issuedDate.slice(0, 10) : '');
      setExpiresDate(editing?.expiresDate ? editing.expiresDate.slice(0, 10) : '');
      setNotes(editing?.notes ?? '');
    }
  }, [visible, editing]);

  const handleSave = useCallback(() => {
    if (!name.trim()) {
      Alert.alert('Name required', 'Give this license a recognizable name (e.g. "NYC DCWP General Contractor").');
      return;
    }
    if (!jurisdiction.trim()) {
      Alert.alert('Jurisdiction required', 'NYC, NY State, Suffolk County, etc.');
      return;
    }
    if (!expiresDate.trim()) {
      Alert.alert('Expiry required', 'When does this license expire?');
      return;
    }
    onSave({
      name: name.trim(),
      licenseNumber: licenseNumber.trim() || undefined,
      licenseType,
      jurisdiction: jurisdiction.trim(),
      issuedDate: issuedDate.trim() ? new Date(issuedDate).toISOString() : undefined,
      expiresDate: new Date(expiresDate).toISOString(),
      notes: notes.trim() || undefined,
    });
  }, [name, licenseNumber, licenseType, jurisdiction, issuedDate, expiresDate, notes, onSave]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={styles.modalRoot}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.modalHeader}>
          <TouchableOpacity onPress={onClose} style={styles.modalClose}>
            <X size={20} color={Colors.text} />
          </TouchableOpacity>
          <Text style={styles.modalTitle}>{editing ? 'Edit license' : 'New license'}</Text>
          <TouchableOpacity onPress={handleSave} style={styles.modalSave}>
            <Check size={18} color={Colors.background} />
            <Text style={styles.modalSaveText}>Save</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.modalBody}>
          <Text style={styles.label}>License name</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="NYC DCWP General Contractor"
            placeholderTextColor={Colors.textMuted}
            style={styles.input}
          />

          <Text style={styles.label}>Type</Text>
          <TouchableOpacity
            style={styles.field}
            onPress={() => setTypePickerOpen(o => !o)}
            activeOpacity={0.85}
          >
            <Text style={styles.fieldText}>{labelForType(licenseType)}</Text>
            <ChevronDown size={16} color={Colors.textMuted} />
          </TouchableOpacity>
          {typePickerOpen && (
            <View style={styles.pickerList}>
              {LICENSE_TYPES.map(t => (
                <TouchableOpacity
                  key={t.key}
                  style={styles.pickerItem}
                  onPress={() => { setLicenseType(t.key); setTypePickerOpen(false); }}
                >
                  <Text style={styles.pickerItemText}>{t.label}</Text>
                  {t.key === licenseType ? <Check size={14} color={Colors.primary} /> : null}
                </TouchableOpacity>
              ))}
            </View>
          )}

          <View style={{ flexDirection: 'row' as const, gap: 10 }}>
            <View style={{ flex: 1.2 }}>
              <Text style={styles.label}>License #</Text>
              <TextInput
                value={licenseNumber}
                onChangeText={setLicenseNumber}
                placeholder="123456"
                placeholderTextColor={Colors.textMuted}
                style={styles.input}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Jurisdiction</Text>
              <TextInput
                value={jurisdiction}
                onChangeText={setJurisdiction}
                placeholder="NYC"
                placeholderTextColor={Colors.textMuted}
                style={styles.input}
              />
            </View>
          </View>

          <View style={{ flexDirection: 'row' as const, gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Issued</Text>
              <TextInput
                value={issuedDate}
                onChangeText={setIssuedDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={Colors.textMuted}
                style={styles.input}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Expires</Text>
              <TextInput
                value={expiresDate}
                onChangeText={setExpiresDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={Colors.textMuted}
                style={styles.input}
              />
            </View>
          </View>

          <Text style={styles.label}>Notes (optional)</Text>
          <TextInput
            value={notes}
            onChangeText={setNotes}
            placeholder="Renewal flow, contact at agency, course requirements..."
            placeholderTextColor={Colors.textMuted}
            multiline
            style={[styles.input, styles.multilineInput]}
          />

          <View style={styles.alertHint}>
            <MapPin size={11} color={Colors.textMuted} />
            <Text style={styles.alertHintText}>
              Compliance hub aggregates this license alongside COIs and permits.
              Reminder ladder (60d / 30d / 14d / 3d) lands in v1.1.
            </Text>
          </View>
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

  card: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: Tokens.spacing.sm,
    backgroundColor: Colors.surface,
    borderRadius: Tokens.radius.lg,
    padding: 14,
    marginHorizontal: Tokens.spacing.md,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: Tokens.radius.sm,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginTop: 1,
  },
  cardTitle: {
    fontSize: Type.subheadline.fontSize,
    fontWeight: '800' as const,
    color: Colors.text,
    letterSpacing: -0.2,
  },
  cardSub: {
    fontSize: Type.footnote.fontSize,
    color: Colors.textSecondary,
    marginTop: Tokens.spacing.hairline,
  },
  metaRow: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 6,
    marginTop: Tokens.spacing.xs,
  },
  metaPill: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: Tokens.spacing.xxs,
    paddingHorizontal: Tokens.spacing.xs,
    paddingVertical: 3,
    borderRadius: Tokens.radius.full,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  metaText: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },
  trashBtn: { padding: 6 },

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

  alertHint: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: 6,
    backgroundColor: Colors.primary + '08',
    borderRadius: Tokens.radius.sm,
    padding: 10,
    marginTop: Tokens.spacing.md,
  },
  alertHintText: {
    flex: 1,
    fontSize: Type.caption2.fontSize,
    color: Colors.textSecondary,
    lineHeight: 14,
  },
});
