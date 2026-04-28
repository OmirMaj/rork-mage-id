// lien-waivers — GC-side hub for managing lien waivers on a project.
// Generate one of the four waiver types pre-filled from a paid invoice
// or commitment. Status flows: requested → signed → received.
//
// Sub-portal-side signing is deferred to a follow-up push; for now the
// GC can also countersign on behalf of the sub when they have a paper
// waiver in hand (which is how a lot of GCs actually operate).

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  ActivityIndicator, Alert, Platform, Modal,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft, Plus, FileSignature, FileDown, CheckCircle2,
  Clock, XCircle, Trash2, ShieldCheck, AlertTriangle,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import {
  fetchLienWaiversForProject, saveLienWaiver, deleteLienWaiver,
  shareLienWaiverPDF, WAIVER_LABELS,
} from '@/utils/lienWaiverEngine';
import { formatMoney } from '@/utils/formatters';
import { statusPillStyle } from '@/utils/statusPill';
import type { LienWaiver, LienWaiverType, CompanyBranding } from '@/types';

export default function LienWaiversScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const { getProject, settings } = useProjects();
  const project = projectId ? getProject(projectId) : undefined;

  const [waivers, setWaivers] = useState<LienWaiver[]>([]);
  const [loading, setLoading] = useState(true);
  const [addModal, setAddModal] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);

  const branding = useMemo<CompanyBranding>(() => ({
    companyName:   settings?.branding?.companyName ?? 'MAGE ID',
    contactName:   settings?.branding?.contactName ?? '',
    phone:         settings?.branding?.phone ?? '',
    email:         settings?.branding?.email ?? '',
    address:       settings?.branding?.address ?? '',
    licenseNumber: settings?.branding?.licenseNumber ?? '',
    tagline:       settings?.branding?.tagline ?? '',
    logoUri:       settings?.branding?.logoUri,
  }), [settings]);

  const refresh = useCallback(async () => {
    if (!projectId) { setLoading(false); return; }
    const list = await fetchLienWaiversForProject(projectId);
    setWaivers(list);
  }, [projectId]);

  useEffect(() => {
    void (async () => {
      setLoading(true); await refresh(); setLoading(false);
    })();
  }, [refresh]);

  const handleCreate = useCallback(async (input: { waiverType: LienWaiverType; subName: string; subEmail?: string; throughDate: string; paidAmount: number; notes?: string }) => {
    if (!projectId || !input.subName.trim()) return;
    const saved = await saveLienWaiver({
      projectId,
      waiverType: input.waiverType,
      subName: input.subName.trim(),
      subEmail: input.subEmail?.trim() || undefined,
      throughDate: input.throughDate,
      paidAmount: input.paidAmount,
      notes: input.notes,
      status: 'requested',
    });
    if (saved) {
      setWaivers(prev => [saved, ...prev]);
      setAddModal(false);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else {
      Alert.alert('Save failed', 'Could not save the waiver.');
    }
  }, [projectId]);

  const handleExport = useCallback(async (w: LienWaiver) => {
    setExporting(w.id);
    try {
      await shareLienWaiverPDF(w, branding, project?.name ?? 'Project', project?.location);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      Alert.alert('Export failed', e instanceof Error ? e.message : 'Could not generate PDF.');
    } finally {
      setExporting(null);
    }
  }, [branding, project]);

  const handleStatusChange = useCallback(async (w: LienWaiver, status: LienWaiver['status']) => {
    const saved = await saveLienWaiver({ ...w, id: w.id, status });
    if (saved) setWaivers(prev => prev.map(x => x.id === w.id ? saved : x));
  }, []);

  const handleMarkSigned = useCallback(async (w: LienWaiver) => {
    const persist = async (rawName: string) => {
      const name = rawName.trim();
      if (!name || name.length < 2) {
        Alert.alert('Name required', 'Type the subcontractor\'s legal name to confirm signature.');
        return;
      }
      try {
        const saved = await saveLienWaiver({
          ...w, id: w.id,
          status: 'signed',
          signedAt: new Date().toISOString(),
          subSignature: { name, role: 'gc', signedAt: new Date().toISOString() },
        });
        if (saved) {
          setWaivers(prev => prev.map(x => x.id === w.id ? saved : x));
          if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        } else {
          Alert.alert('Save failed', 'Could not mark this waiver as signed. Try again.');
        }
      } catch (e) {
        Alert.alert('Save failed', e instanceof Error ? e.message : 'Try again.');
      }
    };
    if (Platform.OS === 'web' || !(Alert as any).prompt) {
      const name = window.prompt(`Type the subcontractor's name to confirm they've signed the waiver in person:`, w.subName);
      if (name == null) return;
      void persist(name);
      return;
    }
    Alert.prompt(
      'Mark as signed',
      `Type the subcontractor's name to confirm they've signed the waiver:`,
      (name) => { if (name != null) void persist(name); },
      'plain-text',
      w.subName,
    );
  }, []);

  const handleDelete = useCallback((w: LienWaiver) => {
    Alert.alert(
      `Delete waiver for ${w.subName}?`,
      'This is permanent.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            const ok = await deleteLienWaiver(w.id);
            if (ok) setWaivers(prev => prev.filter(x => x.id !== w.id));
          },
        },
      ],
    );
  }, []);

  if (!project) {
    return (
      <View style={[styles.container, styles.center, { paddingTop: insets.top + 24 }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <Text style={styles.emptyTitle}>Project not found</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8}>
          <ChevronLeft size={26} color={Colors.primary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>{project.name}</Text>
          <Text style={styles.title}>Lien Waivers</Text>
        </View>
        <TouchableOpacity style={styles.addBtn} onPress={() => setAddModal(true)}>
          <Plus size={14} color="#FFF" />
          <Text style={styles.addBtnText}>New</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 80 }}>
        {loading && (
          <View style={styles.loading}><ActivityIndicator size="small" color={Colors.primary} /></View>
        )}

        {!loading && waivers.length === 0 && (
          <View style={styles.emptyCard}>
            <ShieldCheck size={28} color={Colors.primary} />
            <Text style={styles.emptyTitle}>No waivers yet</Text>
            <Text style={styles.emptyBody}>
              Generate a lien waiver after every sub payment. Banks ask for them on every draw.
              We'll auto-fill the sub's name, paid amount, and through-date — you just pick the type.
            </Text>
            <TouchableOpacity style={styles.bigCta} onPress={() => setAddModal(true)}>
              <Plus size={14} color="#FFF" />
              <Text style={styles.bigCtaText}>New waiver</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.disclaimer}>
          <AlertTriangle size={14} color={Colors.warning} />
          <Text style={styles.disclaimerText}>
            Generic 4-type waivers cover ~38 states. CA, TX, FL, GA, AZ require state-specific
            statutory forms — consult an attorney for those.
          </Text>
        </View>

        {waivers.map(w => (
          <WaiverCard
            key={w.id}
            waiver={w}
            exporting={exporting === w.id}
            onExport={() => handleExport(w)}
            onMarkSigned={() => handleMarkSigned(w)}
            onMarkReceived={() => handleStatusChange(w, 'received')}
            onMarkVoid={() => handleStatusChange(w, 'voided')}
            onDelete={() => handleDelete(w)}
          />
        ))}
      </ScrollView>

      <NewWaiverModal visible={addModal} onClose={() => setAddModal(false)} onCreate={handleCreate} />
    </View>
  );
}

function WaiverCard({ waiver, exporting, onExport, onMarkSigned, onMarkReceived, onMarkVoid, onDelete }: {
  waiver: LienWaiver;
  exporting: boolean;
  onExport: () => void;
  onMarkSigned: () => void;
  onMarkReceived: () => void;
  onMarkVoid: () => void;
  onDelete: () => void;
}) {
  const meta = WAIVER_LABELS[waiver.waiverType];
  // Use the shared statusPillStyle so SIGNED/RECEIVED/VOIDED/REQUESTED
  // match the same color scheme used on contract + closeout binder.
  // Icons stay per-status because they convey extra meaning beyond color.
  const statusIcons = {
    received: CheckCircle2,
    signed:   FileSignature,
    voided:   XCircle,
    requested: Clock,
  } as const;
  const Icon = statusIcons[waiver.status] ?? Clock;
  const labelMap: Record<typeof waiver.status, string> = {
    received: 'RECEIVED', signed: 'SIGNED', voided: 'VOIDED', requested: 'REQUESTED',
  };
  const { color: statusColor, backgroundColor: statusBg } = statusPillStyle(waiver.status);
  const statusCfg = { bg: statusBg, color: statusColor, label: labelMap[waiver.status] };
  const StatusIcon = Icon;

  return (
    <View style={styles.waiverCard}>
      <View style={styles.waiverHead}>
        <View style={{ flex: 1 }}>
          <Text style={styles.waiverType}>{meta.short.toUpperCase()}</Text>
          <Text style={styles.waiverSubName}>{waiver.subName}</Text>
        </View>
        <View style={[styles.statusPill, { backgroundColor: statusCfg.bg }]}>
          <StatusIcon size={11} color={statusCfg.color} />
          <Text style={[styles.statusPillText, { color: statusCfg.color }]}>{statusCfg.label}</Text>
        </View>
      </View>

      <View style={styles.waiverGrid}>
        <View style={styles.waiverField}>
          <Text style={styles.waiverFieldLabel}>Through</Text>
          <Text style={styles.waiverFieldValue}>{new Date(waiver.throughDate).toLocaleDateString()}</Text>
        </View>
        <View style={styles.waiverField}>
          <Text style={styles.waiverFieldLabel}>Amount</Text>
          <Text style={styles.waiverFieldValue}>{formatMoney(waiver.paidAmount)}</Text>
        </View>
      </View>

      {waiver.subSignature && (
        <View style={styles.sigPreview}>
          <FileSignature size={12} color={Colors.success} />
          <Text style={styles.sigPreviewText}>
            Signed by <Text style={{ fontWeight: '800' }}>{waiver.subSignature.name}</Text> on {new Date(waiver.subSignature.signedAt).toLocaleDateString()}
          </Text>
        </View>
      )}

      <View style={styles.waiverActions}>
        <TouchableOpacity style={styles.actionSecondary} onPress={onExport} disabled={exporting}>
          {exporting ? <ActivityIndicator size="small" color={Colors.text} /> : (
            <>
              <FileDown size={13} color={Colors.text} />
              <Text style={styles.actionSecondaryText}>PDF</Text>
            </>
          )}
        </TouchableOpacity>
        {waiver.status === 'requested' && (
          <TouchableOpacity style={styles.actionPrimary} onPress={onMarkSigned}>
            <FileSignature size={13} color="#FFF" />
            <Text style={styles.actionPrimaryText}>Mark signed</Text>
          </TouchableOpacity>
        )}
        {waiver.status === 'signed' && (
          <TouchableOpacity style={styles.actionPrimary} onPress={onMarkReceived}>
            <CheckCircle2 size={13} color="#FFF" />
            <Text style={styles.actionPrimaryText}>Mark received</Text>
          </TouchableOpacity>
        )}
        {(waiver.status === 'requested' || waiver.status === 'signed') && (
          <TouchableOpacity style={styles.actionGhost} onPress={onMarkVoid}>
            <XCircle size={13} color={Colors.warning} />
            <Text style={styles.actionGhostText}>Void</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.actionGhost} onPress={onDelete}>
          <Trash2 size={13} color={Colors.error} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

function NewWaiverModal({ visible, onClose, onCreate }: {
  visible: boolean;
  onClose: () => void;
  onCreate: (input: { waiverType: LienWaiverType; subName: string; subEmail?: string; throughDate: string; paidAmount: number; notes?: string }) => void;
}) {
  const [type, setType] = useState<LienWaiverType>('unconditional_partial');
  const [subName, setSubName] = useState('');
  const [subEmail, setSubEmail] = useState('');
  const [throughDate, setThroughDate] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState('');

  useEffect(() => {
    if (visible) {
      setType('unconditional_partial');
      setSubName(''); setSubEmail('');
      setThroughDate(new Date().toISOString().slice(0, 10));
      setAmount('');
    }
  }, [visible]);

  const handleSubmit = () => {
    const trimmedName = subName.trim();
    const trimmedEmail = subEmail.trim();
    const numericAmount = Number(amount);
    if (!trimmedName) {
      Alert.alert('Sub name required', 'Type the subcontractor\'s legal company or person name.');
      return;
    }
    if (!isFinite(numericAmount) || numericAmount <= 0) {
      Alert.alert('Amount required', 'Enter the dollar amount paid through this date.');
      return;
    }
    if (trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      Alert.alert('Email looks off', 'Either fix the email or leave it blank.');
      return;
    }
    onCreate({
      waiverType: type,
      subName: trimmedName,
      subEmail: trimmedEmail || undefined,
      throughDate,
      paidAmount: numericAmount,
    });
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>New lien waiver</Text>
          <Text style={styles.modalBody}>Pick the type, fill in the sub + amount, generate the PDF.</Text>

          <Text style={styles.modalLabel}>Type</Text>
          <View style={styles.typeRow}>
            {(['conditional_partial', 'unconditional_partial', 'conditional_final', 'unconditional_final'] as LienWaiverType[]).map(t => (
              <TouchableOpacity
                key={t}
                style={[styles.typeChip, type === t && styles.typeChipActive]}
                onPress={() => setType(t)}
              >
                <Text style={[styles.typeChipText, type === t && styles.typeChipTextActive]}>{WAIVER_LABELS[t].short}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.typeHint}>{WAIVER_LABELS[type].description}</Text>

          <Text style={styles.modalLabel}>Subcontractor name *</Text>
          <TextInput
            style={styles.modalInput}
            value={subName}
            onChangeText={setSubName}
            placeholder="Hallway Homes LLC"
            placeholderTextColor={Colors.textMuted}
            autoCapitalize="words"
          />

          <Text style={styles.modalLabel}>Subcontractor email</Text>
          <TextInput
            style={styles.modalInput}
            value={subEmail}
            onChangeText={setSubEmail}
            placeholder="optional — for signing requests later"
            placeholderTextColor={Colors.textMuted}
            keyboardType="email-address"
            autoCapitalize="none"
          />

          <View style={styles.modalRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.modalLabel}>Through date</Text>
              <TextInput
                style={styles.modalInput}
                value={throughDate}
                onChangeText={setThroughDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={Colors.textMuted}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.modalLabel}>Paid amount *</Text>
              <TextInput
                style={styles.modalInput}
                value={amount}
                onChangeText={setAmount}
                placeholder="0"
                placeholderTextColor={Colors.textMuted}
                keyboardType="numeric"
              />
            </View>
          </View>

          <View style={styles.modalActions}>
            <TouchableOpacity style={styles.modalCancel} onPress={onClose}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modalConfirm, (!subName.trim() || !amount) && styles.modalConfirmDisabled]}
              onPress={handleSubmit}
              disabled={!subName.trim() || !Number(amount) || Number(amount) <= 0}
            >
              <Plus size={14} color="#FFF" />
              <Text style={styles.modalConfirmText}>Create</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  eyebrow: { fontSize: 11, fontWeight: '700', color: Colors.primary, letterSpacing: 1.4, textTransform: 'uppercase' },
  title:   { fontSize: 20, fontWeight: '800', color: Colors.text, letterSpacing: -0.4, marginTop: 4 },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 9, backgroundColor: Colors.primary },
  addBtnText: { fontSize: 13, fontWeight: '700', color: '#FFF' },

  loading: { padding: 30, alignItems: 'center' },
  emptyCard: { backgroundColor: Colors.card, borderRadius: 14, padding: 28, alignItems: 'center', gap: 10, marginTop: 22, borderWidth: 1, borderColor: Colors.border },
  emptyTitle: { fontSize: 16, fontWeight: '800', color: Colors.text, marginTop: 4 },
  emptyBody:  { fontSize: 13, color: Colors.textMuted, textAlign: 'center', lineHeight: 19, maxWidth: 320 },
  bigCta: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 18, paddingVertical: 11, borderRadius: 11, backgroundColor: Colors.primary, marginTop: 8 },
  bigCtaText: { color: '#FFF', fontSize: 14, fontWeight: '800' },

  disclaimer: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    padding: 12, borderRadius: 10, marginBottom: 12,
    backgroundColor: Colors.warning + '0D',
    borderWidth: 1, borderColor: Colors.warning + '30',
  },
  disclaimerText: { flex: 1, fontSize: 11, color: Colors.text, lineHeight: 16 },

  waiverCard: {
    backgroundColor: Colors.card, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: Colors.border,
    marginBottom: 10, gap: 10,
  },
  waiverHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  waiverType: { fontSize: 9, fontWeight: '800', color: Colors.primary, letterSpacing: 0.8 },
  waiverSubName: { fontSize: 14, fontWeight: '800', color: Colors.text, marginTop: 3 },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  statusPillText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },

  waiverGrid: { flexDirection: 'row', gap: 12 },
  waiverField: { flex: 1, padding: 8, borderRadius: 8, backgroundColor: Colors.background, borderWidth: 1, borderColor: Colors.border },
  waiverFieldLabel: { fontSize: 9, fontWeight: '800', color: Colors.textMuted, letterSpacing: 0.6 },
  waiverFieldValue: { fontSize: 14, fontWeight: '700', color: Colors.text, marginTop: 2 },

  sigPreview: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 8, borderRadius: 8, backgroundColor: Colors.success + '0D', borderWidth: 1, borderColor: Colors.success + '30' },
  sigPreviewText: { flex: 1, fontSize: 11, color: Colors.text },

  waiverActions: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  actionPrimary: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 9, backgroundColor: Colors.primary },
  actionPrimaryText: { fontSize: 12, fontWeight: '800', color: '#FFF' },
  actionSecondary: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 9, backgroundColor: Colors.background, borderWidth: 1, borderColor: Colors.border },
  actionSecondaryText: { fontSize: 12, fontWeight: '700', color: Colors.text },
  actionGhost: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 9 },
  actionGhostText: { fontSize: 12, fontWeight: '700', color: Colors.warning },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(11, 13, 16, 0.75)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: Colors.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, gap: 8 },
  modalTitle: { fontSize: 18, fontWeight: '800', color: Colors.text },
  modalBody: { fontSize: 13, color: Colors.textMuted, lineHeight: 18 },
  modalLabel: { fontSize: 11, fontWeight: '800', color: Colors.textMuted, letterSpacing: 0.6, textTransform: 'uppercase', marginTop: 8 },
  modalInput: {
    backgroundColor: Colors.background, borderWidth: 1, borderColor: Colors.border, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 11, fontSize: 14, color: Colors.text,
  },
  modalRow: { flexDirection: 'row', gap: 10, marginTop: -4 },
  typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  typeChip: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 9, backgroundColor: Colors.background, borderWidth: 1, borderColor: Colors.border },
  typeChipActive: { backgroundColor: Colors.primary + '15', borderColor: Colors.primary },
  typeChipText: { fontSize: 11, fontWeight: '700', color: Colors.text },
  typeChipTextActive: { color: Colors.primary },
  typeHint: { fontSize: 11, color: Colors.textMuted, lineHeight: 16, marginTop: 4, fontStyle: 'italic' },

  modalActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  modalCancel: { flex: 1, paddingVertical: 12, borderRadius: 11, backgroundColor: Colors.background, alignItems: 'center', borderWidth: 1, borderColor: Colors.border },
  modalCancelText: { fontSize: 14, fontWeight: '700', color: Colors.text },
  modalConfirm: { flex: 1.4, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: 11, backgroundColor: Colors.primary },
  modalConfirmDisabled: { opacity: 0.45 },
  modalConfirmText: { fontSize: 14, fontWeight: '800', color: '#FFF' },
});
