// contract — GC-side contract editor. Drafts the formal scope-of-work +
// payment schedule, captures the GC signature, sends it to the homeowner
// via the portal for counter-signature.
//
// Flow:
//   1. GC opens this screen from a project. We load (or seed) the active
//      contract for the project.
//   2. GC edits scope/value/payment-schedule/allowances inline.
//   3. GC taps "Sign & Send" → captures their signature, sets status to
//      'sent', the homeowner sees + signs in the portal.
//   4. Once both signatures are on, status is 'signed' and the contract
//      is the binding document. Subsequent invoices reference it.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  ActivityIndicator, Alert, Platform, Modal,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft, FileText, Plus, Trash2, DollarSign, Calendar, Send,
  CheckCircle2, AlertTriangle, Edit3, FileSignature, ChevronRight,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { useAuth } from '@/contexts/AuthContext';
import {
  fetchActiveContract, saveContract, setContractStatus,
  buildDraftContract, defaultPaymentSchedule,
} from '@/utils/contractEngine';
import { generateUUID } from '@/utils/generateId';
import { formatMoney } from '@/utils/formatters';
import SignaturePad from '@/components/SignaturePad';
import type { ProjectContract, PaymentMilestone, ContractAllowance } from '@/types';

export default function ContractScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const { getProject } = useProjects();
  const project = projectId ? getProject(projectId) : undefined;

  const [contract, setContract] = useState<ProjectContract | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [signing, setSigning] = useState(false);
  const [signatureModal, setSignatureModal] = useState(false);

  // Load (or seed a draft for) this project's contract.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!project) { setLoading(false); return; }
      const existing = await fetchActiveContract(project.id);
      if (cancelled) return;
      if (existing) {
        setContract(existing);
      } else {
        // Seed a draft from the project — caller can edit before saving.
        const draft = buildDraftContract({ project });
        setContract({
          ...draft,
          id: '',
          userId: user?.id ?? '',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [project, user]);

  // Generic field setter.
  const updateContract = useCallback(<K extends keyof ProjectContract>(key: K, value: ProjectContract[K]) => {
    setContract(prev => prev ? { ...prev, [key]: value } : prev);
  }, []);

  // Re-balance the payment schedule when contract value changes — only
  // for milestones that were % based; fixed-dollar entries stay put.
  const handleValueChange = useCallback((newValue: number) => {
    setContract(prev => {
      if (!prev) return prev;
      const next = { ...prev, contractValue: newValue };
      next.paymentSchedule = prev.paymentSchedule.map(m => {
        if (m.percent != null) {
          return { ...m, amount: Math.round(newValue * (m.percent / 100)) };
        }
        return m;
      });
      return next;
    });
  }, []);

  const addMilestone = useCallback(() => {
    setContract(prev => prev ? {
      ...prev,
      paymentSchedule: [...prev.paymentSchedule, {
        id: generateUUID(),
        label: 'New milestone',
        trigger: 'on_milestone',
        triggerMilestone: '',
        amount: 0,
        status: 'pending',
      }],
    } : prev);
  }, []);

  const removeMilestone = useCallback((id: string) => {
    const m = contract?.paymentSchedule.find(x => x.id === id);
    const amount = m?.amount;
    Alert.alert(
      'Remove this milestone?',
      m?.label
        ? `"${m.label}"${amount ? ` — $${amount.toLocaleString()}` : ''} will be removed from the payment schedule.`
        : 'This milestone will be removed from the payment schedule.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => {
          setContract(prev => prev ? {
            ...prev,
            paymentSchedule: prev.paymentSchedule.filter(x => x.id !== id),
          } : prev);
        } },
      ],
    );
  }, [contract]);

  const updateMilestone = useCallback((id: string, patch: Partial<PaymentMilestone>) => {
    setContract(prev => prev ? {
      ...prev,
      paymentSchedule: prev.paymentSchedule.map(m => m.id === id ? { ...m, ...patch } : m),
    } : prev);
  }, []);

  const addAllowance = useCallback(() => {
    setContract(prev => prev ? {
      ...prev,
      allowances: [...prev.allowances, { id: generateUUID(), category: '', amount: 0 }],
    } : prev);
  }, []);

  const removeAllowance = useCallback((id: string) => {
    setContract(prev => prev ? {
      ...prev,
      allowances: prev.allowances.filter(a => a.id !== id),
    } : prev);
  }, []);

  const updateAllowance = useCallback((id: string, patch: Partial<ContractAllowance>) => {
    setContract(prev => prev ? {
      ...prev,
      allowances: prev.allowances.map(a => a.id === id ? { ...a, ...patch } : a),
    } : prev);
  }, []);

  // Save the draft (no status change). Used as a debounced auto-save
  // OR explicit "Save draft" button.
  const handleSaveDraft = useCallback(async () => {
    if (!contract) return;
    setSaving(true);
    try {
      const saved = await saveContract({ ...contract, id: contract.id || undefined });
      if (saved) {
        setContract(saved);
        if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        Alert.alert('Save failed', 'Could not save the contract. Check your connection.');
      }
    } finally {
      setSaving(false);
    }
  }, [contract]);

  // Sign + send — captures the GC's signature, status='sent'.
  const handleSignAndSend = useCallback(async (signaturePaths: string[], typedName: string) => {
    if (!contract) return;
    if (!typedName.trim()) {
      Alert.alert('Name required', 'Type your full legal name to sign the contract.');
      return;
    }
    setSigning(true);
    try {
      // Save first to get an id.
      const saved = await saveContract({ ...contract, id: contract.id || undefined });
      if (!saved) {
        Alert.alert('Save failed', 'Could not save the contract before signing.');
        return;
      }
      // Then attach the GC signature + flip status to 'sent'.
      const ok = await setContractStatus(saved.id, 'sent', {
        gcSignature: {
          name: typedName.trim(),
          role: 'gc',
          signedAt: new Date().toISOString(),
          signaturePaths,
        },
      });
      if (!ok) {
        Alert.alert('Send failed', 'Saved as draft but could not mark as sent.');
        return;
      }
      const refreshed = await fetchActiveContract(saved.projectId);
      if (refreshed) setContract(refreshed);
      setSignatureModal(false);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        'Contract sent',
        'The homeowner can now review and counter-sign in their portal. You\'ll be notified when they do.',
      );
    } finally {
      setSigning(false);
    }
  }, [contract]);

  if (loading || !contract || !project) {
    return (
      <View style={[styles.container, styles.center, { paddingTop: insets.top + 24 }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator size="small" color={Colors.primary} />
      </View>
    );
  }

  const isLocked = contract.status === 'sent' || contract.status === 'signed';
  const totalScheduled = contract.paymentSchedule.reduce((s, m) => s + (m.amount ?? 0), 0);
  const scheduleMatchesValue = Math.abs(totalScheduled - contract.contractValue) < 1;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8}>
          <ChevronLeft size={26} color={Colors.primary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>{project.name}</Text>
          <Text style={styles.title}>Construction Agreement</Text>
        </View>
        <StatusPill status={contract.status} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 100 }}>
        {/* Title + value */}
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Contract title</Text>
          <TextInput
            style={[styles.input, isLocked && styles.inputDisabled]}
            value={contract.title}
            onChangeText={v => updateContract('title', v)}
            editable={!isLocked}
            placeholder="Construction Agreement"
            placeholderTextColor={Colors.textMuted}
          />
          <Text style={[styles.cardLabel, { marginTop: 14 }]}>Contract value</Text>
          <View style={styles.amountField}>
            <DollarSign size={16} color={Colors.textMuted} />
            <TextInput
              style={[styles.amountInput, isLocked && styles.inputDisabled]}
              value={String(contract.contractValue || '')}
              onChangeText={v => handleValueChange(Number(v.replace(/[^0-9.]/g, '')) || 0)}
              keyboardType="numeric"
              editable={!isLocked}
              placeholder="0"
              placeholderTextColor={Colors.textMuted}
            />
          </View>
        </View>

        {/* Scope */}
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Scope of work *</Text>
          <Text style={styles.cardHelper}>What you'll build, materials of note, exclusions. Be specific — this is what the homeowner agrees to.</Text>
          <TextInput
            style={[styles.input, styles.inputMultiline, isLocked && styles.inputDisabled]}
            value={contract.scopeText}
            onChangeText={v => updateContract('scopeText', v)}
            editable={!isLocked}
            multiline
            numberOfLines={8}
            placeholder="Describe the scope in detail..."
            placeholderTextColor={Colors.textMuted}
            textAlignVertical="top"
          />
        </View>

        {/* Payment schedule */}
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardLabel}>Payment schedule</Text>
              <Text style={styles.cardHelper}>
                Tied to specific triggers. Total must equal contract value.
              </Text>
            </View>
            {!isLocked && (
              <TouchableOpacity style={styles.smallBtn} onPress={addMilestone}>
                <Plus size={14} color={Colors.primary} />
                <Text style={styles.smallBtnText}>Add</Text>
              </TouchableOpacity>
            )}
          </View>

          {contract.paymentSchedule.map((m) => (
            <MilestoneRow
              key={m.id}
              milestone={m}
              locked={isLocked}
              onChange={patch => updateMilestone(m.id, patch)}
              onRemove={() => removeMilestone(m.id)}
            />
          ))}

          <View style={styles.scheduleTotalRow}>
            <Text style={styles.scheduleTotalLabel}>Total scheduled</Text>
            <Text style={[
              styles.scheduleTotalValue,
              !scheduleMatchesValue && { color: Colors.warning },
            ]}>
              {formatMoney(totalScheduled)}
              {!scheduleMatchesValue && <Text style={styles.scheduleMismatch}>  · ≠ contract value</Text>}
            </Text>
          </View>

          {!isLocked && !scheduleMatchesValue && (
            <TouchableOpacity
              style={styles.rebalanceBtn}
              onPress={() => updateContract('paymentSchedule', defaultPaymentSchedule(contract.contractValue))}
            >
              <Text style={styles.rebalanceText}>Reset to default 25/25/25/25 schedule</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Allowances */}
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardLabel}>Allowances (optional)</Text>
              <Text style={styles.cardHelper}>
                Budget set aside for finishes the homeowner picks (cabinets, fixtures, tile, etc.).
                Overruns trigger a Change Order.
              </Text>
            </View>
            {!isLocked && (
              <TouchableOpacity style={styles.smallBtn} onPress={addAllowance}>
                <Plus size={14} color={Colors.primary} />
                <Text style={styles.smallBtnText}>Add</Text>
              </TouchableOpacity>
            )}
          </View>
          {contract.allowances.map(a => (
            <View key={a.id} style={styles.allowanceRow}>
              <TextInput
                style={[styles.allowanceCategory, isLocked && styles.inputDisabled]}
                value={a.category}
                onChangeText={v => updateAllowance(a.id, { category: v })}
                editable={!isLocked}
                placeholder="Category"
                placeholderTextColor={Colors.textMuted}
              />
              <View style={styles.allowanceAmountField}>
                <DollarSign size={12} color={Colors.textMuted} />
                <TextInput
                  style={[styles.allowanceAmount, isLocked && styles.inputDisabled]}
                  value={String(a.amount || '')}
                  onChangeText={v => updateAllowance(a.id, { amount: Number(v.replace(/[^0-9.]/g, '')) || 0 })}
                  keyboardType="numeric"
                  editable={!isLocked}
                  placeholder="0"
                  placeholderTextColor={Colors.textMuted}
                />
              </View>
              {!isLocked && (
                <TouchableOpacity onPress={() => removeAllowance(a.id)} hitSlop={6}>
                  <Trash2 size={14} color={Colors.error} />
                </TouchableOpacity>
              )}
            </View>
          ))}
          {contract.allowances.length === 0 && (
            <Text style={styles.allowanceEmpty}>
              No allowances yet. Tap Add to set a budget for fixtures, finishes, or any homeowner-picked items.
            </Text>
          )}
        </View>

        {/* Terms */}
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Terms &amp; conditions</Text>
          <TextInput
            style={[styles.input, styles.inputTermsMultiline, isLocked && styles.inputDisabled]}
            value={contract.termsText}
            onChangeText={v => updateContract('termsText', v)}
            editable={!isLocked}
            multiline
            numberOfLines={10}
            textAlignVertical="top"
          />
        </View>

        {/* Warranty */}
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Warranty</Text>
          <TextInput
            style={[styles.input, styles.inputMultiline, isLocked && styles.inputDisabled]}
            value={contract.warrantyText}
            onChangeText={v => updateContract('warrantyText', v)}
            editable={!isLocked}
            multiline
            numberOfLines={6}
            textAlignVertical="top"
          />
        </View>

        {/* Signatures */}
        {(contract.gcSignature || contract.homeownerSignature) && (
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Signatures</Text>
            {contract.gcSignature && (
              <SignatureBlock label="Contractor" name={contract.gcSignature.name} signedAt={contract.gcSignature.signedAt} />
            )}
            {contract.homeownerSignature && (
              <SignatureBlock label="Homeowner" name={contract.homeownerSignature.name} signedAt={contract.homeownerSignature.signedAt} />
            )}
          </View>
        )}

        {/* Action bar */}
        {contract.status === 'draft' && (
          <View style={styles.actionRow}>
            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={handleSaveDraft}
              disabled={saving}
              activeOpacity={0.85}
            >
              {saving ? <ActivityIndicator size="small" color={Colors.text} /> : (
                <>
                  <Edit3 size={14} color={Colors.text} />
                  <Text style={styles.secondaryBtnText}>Save draft</Text>
                </>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.primaryBtn, !scheduleMatchesValue && styles.primaryBtnDisabled]}
              onPress={() => setSignatureModal(true)}
              disabled={!scheduleMatchesValue || saving}
              activeOpacity={0.85}
            >
              <FileSignature size={16} color="#FFF" />
              <Text style={styles.primaryBtnText}>Sign &amp; send</Text>
            </TouchableOpacity>
          </View>
        )}

        {contract.status === 'sent' && (
          <View style={styles.statusBanner}>
            <Send size={16} color={Colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.statusBannerTitle}>Sent to the homeowner</Text>
              <Text style={styles.statusBannerBody}>
                You'll be notified when they sign. Until then this contract is read-only.
              </Text>
            </View>
          </View>
        )}

        {contract.status === 'signed' && (
          <View style={[styles.statusBanner, { backgroundColor: Colors.success + '0D', borderColor: Colors.success + '30' }]}>
            <CheckCircle2 size={16} color={Colors.success} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.statusBannerTitle, { color: Colors.success }]}>Signed by both parties</Text>
              <Text style={styles.statusBannerBody}>
                Binding agreement on file. Invoices on this project should reference it.
              </Text>
            </View>
          </View>
        )}
      </ScrollView>

      {/* Signature modal */}
      <SignatureModal
        visible={signatureModal}
        onClose={() => setSignatureModal(false)}
        onSign={handleSignAndSend}
        signing={signing}
        defaultName={user?.name ?? user?.email ?? ''}
      />
    </View>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────

function StatusPill({ status }: { status: ProjectContract['status'] }) {
  const cfg =
    status === 'signed' ? { bg: Colors.success + '15', color: Colors.success, label: 'SIGNED' } :
    status === 'sent'   ? { bg: Colors.primary + '15', color: Colors.primary, label: 'SENT' } :
    status === 'void'   ? { bg: Colors.error + '15',   color: Colors.error,   label: 'VOID' } :
                          { bg: Colors.background,     color: Colors.textMuted, label: 'DRAFT' };
  return (
    <View style={[styles.pill, { backgroundColor: cfg.bg }]}>
      <Text style={[styles.pillText, { color: cfg.color }]}>{cfg.label}</Text>
    </View>
  );
}

function MilestoneRow({ milestone, locked, onChange, onRemove }: {
  milestone: PaymentMilestone;
  locked: boolean;
  onChange: (patch: Partial<PaymentMilestone>) => void;
  onRemove: () => void;
}) {
  const cfg =
    milestone.status === 'paid'     ? { bg: Colors.success + '15', color: Colors.success, label: 'PAID' } :
    milestone.status === 'invoiced' ? { bg: Colors.primary + '15', color: Colors.primary, label: 'INVOICED' } :
    milestone.status === 'skipped'  ? { bg: Colors.background,     color: Colors.textMuted, label: 'SKIPPED' } :
                                       { bg: Colors.background,    color: Colors.textMuted, label: 'PENDING' };
  return (
    <View style={styles.milestone}>
      <View style={styles.milestoneTop}>
        <TextInput
          style={[styles.milestoneLabel, locked && styles.inputDisabled]}
          value={milestone.label}
          onChangeText={v => onChange({ label: v })}
          editable={!locked}
          placeholder="Milestone label"
          placeholderTextColor={Colors.textMuted}
        />
        <View style={[styles.milestoneStatus, { backgroundColor: cfg.bg }]}>
          <Text style={[styles.milestoneStatusText, { color: cfg.color }]}>{cfg.label}</Text>
        </View>
        {!locked && (
          <TouchableOpacity onPress={onRemove} hitSlop={6}>
            <Trash2 size={14} color={Colors.error} />
          </TouchableOpacity>
        )}
      </View>
      <View style={styles.milestoneBottom}>
        <View style={styles.amountField}>
          <DollarSign size={14} color={Colors.textMuted} />
          <TextInput
            style={[styles.milestoneAmount, locked && styles.inputDisabled]}
            value={String(milestone.amount ?? '')}
            onChangeText={v => onChange({ amount: Number(v.replace(/[^0-9.]/g, '')) || 0 })}
            keyboardType="numeric"
            editable={!locked}
            placeholder="0"
            placeholderTextColor={Colors.textMuted}
          />
        </View>
        <Text style={styles.milestoneTrigger}>
          {milestone.trigger === 'on_signing'   ? 'On signing'
          : milestone.trigger === 'on_final'    ? 'On final completion'
          : milestone.trigger === 'on_invoice'  ? 'On invoice'
          : milestone.trigger === 'on_date'     ? `On ${milestone.triggerDate ?? 'date'}`
          : milestone.triggerMilestone || 'On milestone'}
        </Text>
      </View>
      {milestone.trigger === 'on_milestone' && !locked && (
        <TextInput
          style={[styles.milestoneTriggerInput]}
          value={milestone.triggerMilestone ?? ''}
          onChangeText={v => onChange({ triggerMilestone: v })}
          placeholder="Trigger description (e.g. Foundation pour complete)"
          placeholderTextColor={Colors.textMuted}
        />
      )}
    </View>
  );
}

function SignatureBlock({ label, name, signedAt }: { label: string; name: string; signedAt: string }) {
  return (
    <View style={styles.sigBlock}>
      <Text style={styles.sigLabel}>{label}</Text>
      <Text style={styles.sigName}>{name}</Text>
      <Text style={styles.sigDate}>Signed {new Date(signedAt).toLocaleDateString()}</Text>
    </View>
  );
}

function SignatureModal({ visible, onClose, onSign, signing, defaultName }: {
  visible: boolean;
  onClose: () => void;
  onSign: (paths: string[], typedName: string) => void;
  signing: boolean;
  defaultName: string;
}) {
  const [paths, setPaths] = useState<string[]>([]);
  const [typedName, setTypedName] = useState('');

  useEffect(() => {
    if (visible) {
      setPaths([]);
      setTypedName(defaultName);
    }
  }, [visible, defaultName]);

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Sign &amp; send</Text>
          <Text style={styles.modalBody}>
            Sign below + type your full legal name. The contract becomes binding when the
            homeowner counter-signs in their portal.
          </Text>
          <SignaturePad
            initialPaths={paths}
            onSave={setPaths}
            onClear={() => setPaths([])}
            height={150}
          />
          <TextInput
            style={styles.modalNameInput}
            value={typedName}
            onChangeText={setTypedName}
            placeholder="Your full legal name"
            placeholderTextColor={Colors.textMuted}
            autoCapitalize="words"
          />
          <View style={styles.modalActions}>
            <TouchableOpacity style={styles.modalCancel} onPress={onClose} disabled={signing}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modalConfirm, (paths.length === 0 || !typedName.trim()) && styles.primaryBtnDisabled]}
              onPress={() => onSign(paths, typedName)}
              disabled={signing || paths.length === 0 || !typedName.trim()}
            >
              {signing ? <ActivityIndicator size="small" color="#FFF" /> : (
                <>
                  <FileSignature size={14} color="#FFF" />
                  <Text style={styles.modalConfirmText}>Sign &amp; send</Text>
                </>
              )}
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

  pill: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999 },
  pillText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },

  card: {
    backgroundColor: Colors.card, borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: Colors.border, marginBottom: 12,
  },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 4 },
  cardLabel: { fontSize: 11, fontWeight: '800', color: Colors.textMuted, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 6 },
  cardHelper: { fontSize: 12, color: Colors.textMuted, marginBottom: 10, lineHeight: 17 },

  smallBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 9,
    backgroundColor: Colors.primary + '0D',
    borderWidth: 1, borderColor: Colors.primary + '30',
  },
  smallBtnText: { fontSize: 12, fontWeight: '800', color: Colors.primary },

  input: {
    backgroundColor: Colors.background,
    borderWidth: 1, borderColor: Colors.border, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 11,
    fontSize: 14, color: Colors.text,
  },
  inputDisabled: { opacity: 0.7 },
  inputMultiline: { minHeight: 110, paddingTop: 11 },
  inputTermsMultiline: { minHeight: 200, paddingTop: 11, fontSize: 12, lineHeight: 18 },

  amountField: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.background, borderRadius: 10,
    borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: 14, paddingVertical: 8,
  },
  amountInput: { flex: 1, fontSize: 18, fontWeight: '800', color: Colors.text },

  milestone: {
    backgroundColor: Colors.background, borderRadius: 10,
    borderWidth: 1, borderColor: Colors.border,
    padding: 10, marginBottom: 8, gap: 8,
  },
  milestoneTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  milestoneLabel: { flex: 1, fontSize: 13, fontWeight: '700', color: Colors.text, padding: 0 },
  milestoneStatus: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999 },
  milestoneStatusText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  milestoneBottom: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  milestoneAmount: { flex: 1, fontSize: 14, fontWeight: '700', color: Colors.text, padding: 0 },
  milestoneTrigger: { fontSize: 11, color: Colors.textMuted, fontWeight: '600' },
  milestoneTriggerInput: {
    fontSize: 12, color: Colors.text,
    backgroundColor: Colors.surface, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 6,
    borderWidth: 1, borderColor: Colors.border,
  },

  scheduleTotalRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingTop: 10, marginTop: 4,
    borderTopWidth: 1, borderTopColor: Colors.border,
  },
  scheduleTotalLabel: { fontSize: 12, fontWeight: '700', color: Colors.textMuted, letterSpacing: 0.4, textTransform: 'uppercase' },
  scheduleTotalValue: { fontSize: 16, fontWeight: '800', color: Colors.text },
  scheduleMismatch: { fontSize: 11, fontWeight: '600', color: Colors.warning },
  rebalanceBtn: { paddingTop: 8, alignSelf: 'flex-start' },
  rebalanceText: { fontSize: 12, color: Colors.primary, fontWeight: '700' },

  allowanceRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.background, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 8, marginBottom: 6,
    borderWidth: 1, borderColor: Colors.border,
  },
  allowanceCategory: { flex: 1, fontSize: 13, color: Colors.text, padding: 0 },
  allowanceAmountField: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4,
    backgroundColor: Colors.surface, borderRadius: 8,
    borderWidth: 1, borderColor: Colors.border,
    minWidth: 100,
  },
  allowanceAmount: { fontSize: 13, fontWeight: '700', color: Colors.text, padding: 0, flex: 1 },
  allowanceEmpty: { fontSize: 12, color: Colors.textMuted, fontStyle: 'italic', textAlign: 'center', paddingVertical: 12 },

  sigBlock: {
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  sigLabel: { fontSize: 10, fontWeight: '800', color: Colors.textMuted, letterSpacing: 0.6, textTransform: 'uppercase' },
  sigName:  { fontSize: 16, fontWeight: '800', color: Colors.text, fontStyle: 'italic', marginTop: 4 },
  sigDate:  { fontSize: 11, color: Colors.textMuted, marginTop: 2 },

  actionRow: { flexDirection: 'row', gap: 10, marginTop: 10 },
  primaryBtn: {
    flex: 1.4, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, borderRadius: 12,
    backgroundColor: Colors.primary,
    shadowColor: Colors.primary, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.28, shadowRadius: 8, elevation: 4,
  },
  primaryBtnText: { fontSize: 14, fontWeight: '800', color: '#FFF' },
  primaryBtnDisabled: { opacity: 0.45 },
  secondaryBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 13, borderRadius: 11,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border,
  },
  secondaryBtnText: { fontSize: 13, fontWeight: '700', color: Colors.text },

  statusBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    padding: 14, borderRadius: 12,
    backgroundColor: Colors.primary + '0D',
    borderWidth: 1, borderColor: Colors.primary + '30',
    marginTop: 10,
  },
  statusBannerTitle: { fontSize: 14, fontWeight: '800', color: Colors.primary },
  statusBannerBody:  { fontSize: 12, color: Colors.text, marginTop: 3, lineHeight: 17 },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(11, 13, 16, 0.75)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: Colors.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, gap: 12 },
  modalTitle: { fontSize: 18, fontWeight: '800', color: Colors.text },
  modalBody: { fontSize: 13, color: Colors.textMuted, lineHeight: 18 },
  modalNameInput: {
    backgroundColor: Colors.background,
    borderWidth: 1, borderColor: Colors.border, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, fontWeight: '700', color: Colors.text,
  },
  modalActions: { flexDirection: 'row', gap: 10 },
  modalCancel: { flex: 1, paddingVertical: 12, borderRadius: 11, backgroundColor: Colors.background, alignItems: 'center', borderWidth: 1, borderColor: Colors.border },
  modalCancelText: { fontSize: 14, fontWeight: '700', color: Colors.text },
  modalConfirm: { flex: 1.4, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: 11, backgroundColor: Colors.primary },
  modalConfirmText: { fontSize: 14, fontWeight: '800', color: '#FFF' },
});
