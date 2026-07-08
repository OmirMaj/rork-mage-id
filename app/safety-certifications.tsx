import React, { useState, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  Alert, Platform, Modal, KeyboardAvoidingView, Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Plus, X, Award, Trash2, FileText, User, AlertTriangle } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { useTierAccess } from '@/hooks/useTierAccess';
import { useSafety } from '@/contexts/SafetyContext';
import { useCrew } from '@/contexts/CrewContext';
import { useProjects } from '@/contexts/ProjectContext';
import { useAuth } from '@/contexts/AuthContext';
import Paywall from '@/components/Paywall';
import EmptyState from '@/components/EmptyState';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { generateUUID } from '@/utils/generateId';
import { certStatus } from '@/utils/safety/certStatus';
import type { Certification, CertificationStatus, CrewMember } from '@/types';

// Quick-pick common certification types. Free text is still allowed.
const TYPE_QUICKPICKS = ['OSHA 10', 'OSHA 30', 'SST', 'CPR', 'First Aid'];

const STATUS_STYLE = (t: ThemeColors): Record<CertificationStatus, { label: string; color: string }> => ({
  valid:    { label: 'Valid',    color: t.success },
  expiring: { label: 'Expiring', color: t.accent },
  expired:  { label: 'Expired',  color: t.danger },
});

type StatusFilter = 'all' | 'expiring' | 'expired' | 'valid';

export default function SafetyCertificationsScreen() {
  const router = useRouter();
  const { canAccess } = useTierAccess();
  if (!canAccess('safety_management')) {
    return (
      <Paywall
        visible={true}
        feature="Safety Management"
        requiredTier="business"
        onClose={() => router.back()}
      />
    );
  }
  return <SafetyCertificationsInner />;
}

function SafetyCertificationsInner() {
  const insets = useSafeAreaInsets();
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const { certifications, certificationsWithStatus, addCertification, updateCertification, deleteCertification } = useSafety();
  const { crewMembers } = useCrew();
  const { subcontractors } = useProjects();

  // Person anchor + sub lookups.
  const memberById = useMemo(() => new Map(crewMembers.map((m) => [m.id, m])), [crewMembers]);
  const subById = useMemo(() => new Map(subcontractors.map((s) => [s.id, s])), [subcontractors]);
  const activeMembers = useMemo(() => crewMembers.filter((m) => m.status === 'active'), [crewMembers]);

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const withStatus = useMemo(() => certificationsWithStatus(today), [certificationsWithStatus, today]);

  const STATUS = useMemo(() => STATUS_STYLE(themeColors), [themeColors]);
  const expiringCount = useMemo(() => withStatus.filter((c) => c.status !== 'valid').length, [withStatus]);

  const [filter, setFilter] = useState<StatusFilter>('all');
  const filtered = useMemo(
    () => (filter === 'all' ? withStatus : withStatus.filter((c) => c.status === filter)),
    [withStatus, filter],
  );

  const displayName = useCallback(
    (c: Certification) => (c.workerId && memberById.get(c.workerId)?.fullName) || c.holderName || 'Unnamed',
    [memberById],
  );

  // ── Form state (workerId lives alongside holderName; picking a crew
  //    member sets both, "Clear" unlinks and frees the name field). ──
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Certification | null>(null);
  const [workerId, setWorkerId] = useState<string | undefined>(undefined);
  const [holderName, setHolderName] = useState('');
  const [type, setType] = useState('');
  const [subId, setSubId] = useState('');
  const [issuedDate, setIssuedDate] = useState('');
  const [expiresDate, setExpiresDate] = useState('');
  const [documentUrl, setDocumentUrl] = useState('');

  const resetForm = useCallback(() => {
    setEditing(null);
    setWorkerId(undefined);
    setHolderName('');
    setType('');
    setSubId('');
    setIssuedDate('');
    setExpiresDate('');
    setDocumentUrl('');
  }, []);

  const openNew = useCallback(() => {
    resetForm();
    setShowForm(true);
  }, [resetForm]);

  const openEdit = useCallback((cert: Certification) => {
    setEditing(cert);
    setWorkerId(cert.workerId);
    setHolderName(cert.holderName ?? '');
    setType(cert.type);
    setSubId(cert.subId ?? '');
    setIssuedDate(cert.issuedDate ?? '');
    setExpiresDate(cert.expiresDate ?? '');
    setDocumentUrl(cert.documentUrl ?? '');
    setShowForm(true);
  }, []);

  const pickMember = useCallback((member: CrewMember) => {
    setWorkerId(member.id);
    setHolderName(member.fullName);
  }, []);
  const clearMember = useCallback(() => setWorkerId(undefined), []);

  const handleSave = useCallback(() => {
    const holder = holderName.trim();
    if (!workerId && !holder) { Alert.alert('Missing info', 'Pick a crew member or enter a holder name.'); return; }
    if (!type.trim()) { Alert.alert('Missing info', 'Certification type is required.'); return; }
    const status = certStatus(expiresDate || undefined, today);
    if (editing) {
      updateCertification(editing.id, { workerId, holderName: holder || undefined, type: type.trim(), subId: subId || undefined, issuedDate: issuedDate || undefined, expiresDate: expiresDate || undefined, documentUrl: documentUrl || undefined, status });
    } else {
      const cert: Certification = {
        id: generateUUID(), workerId, holderName: holder || undefined, type: type.trim(),
        subId: subId || undefined, issuedDate: issuedDate || undefined,
        expiresDate: expiresDate || undefined, documentUrl: documentUrl || undefined,
        status, createdAt: new Date().toISOString(), createdBy: userId ?? '',
      };
      addCertification(cert);
    }
    setShowForm(false);
    resetForm();
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [workerId, holderName, type, subId, issuedDate, expiresDate, documentUrl, today, editing, userId, addCertification, updateCertification, resetForm]);

  const handleDelete = useCallback((cert: Certification) => {
    Alert.alert('Delete certification', `Delete "${cert.type}" for ${displayName(cert)}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteCertification(cert.id) },
    ]);
  }, [deleteCertification, displayName]);

  const openDocument = useCallback((url: string) => {
    void Linking.openURL(url).catch(() => Alert.alert('Cannot open', 'This document link could not be opened.'));
  }, []);

  const filterChips: { key: StatusFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'expiring', label: 'Expiring' },
    { key: 'expired', label: 'Expired' },
    { key: 'valid', label: 'Valid' },
  ];

  return (
    <View style={[styles.container, { backgroundColor: themeColors.bg }]}>
      <Stack.Screen options={{ title: 'Certifications' }} />
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
        {/* Expiring-soon summary banner */}
        <View style={[styles.banner, expiringCount > 0 ? { backgroundColor: themeColors.accent + '14', borderColor: themeColors.accent + '26' } : { backgroundColor: themeColors.success + '12', borderColor: themeColors.success + '22' }]}>
          <AlertTriangle size={18} color={expiringCount > 0 ? themeColors.accent : themeColors.success} strokeWidth={1.75} />
          <Text style={styles.bannerText}>
            {expiringCount > 0
              ? `${expiringCount} certification${expiringCount === 1 ? '' : 's'} expiring soon or expired`
              : 'All certifications are current'}
          </Text>
        </View>

        {/* Status filter chips */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
          {filterChips.map((chip) => {
            const active = filter === chip.key;
            return (
              <TouchableOpacity
                key={chip.key}
                style={[styles.filterChip, active && { backgroundColor: themeColors.accent }]}
                onPress={() => setFilter(chip.key)}
              >
                <Text style={[styles.filterChipText, active && { color: '#fff' }]}>{chip.label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {filtered.map((cert) => {
          const s = STATUS[cert.status];
          const sub = cert.subId ? subById.get(cert.subId) : undefined;
          const isCrew = !!(cert.workerId && memberById.get(cert.workerId));
          return (
            <TouchableOpacity key={cert.id} style={styles.card} onPress={() => openEdit(cert)} activeOpacity={0.85}>
              <View style={styles.cardTop}>
                <View style={{ flex: 1 }}>
                  <View style={styles.nameRow}>
                    <Text style={styles.cardName}>{displayName(cert)}</Text>
                    {isCrew && (
                      <View style={styles.crewTag}>
                        <User size={10} color={themeColors.accent} strokeWidth={2} />
                        <Text style={styles.crewTagText}>Crew</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.cardType}>{cert.type}</Text>
                </View>
                <View style={[styles.statusBadge, { backgroundColor: s.color + '18' }]}>
                  <Text style={[styles.statusBadgeText, { color: s.color }]}>{s.label}</Text>
                </View>
              </View>

              <Text style={styles.cardMeta}>{cert.expiresDate ? `Expires ${cert.expiresDate}` : 'No expiry'}</Text>

              <View style={styles.chipRow}>
                {sub ? <Text style={styles.subName}>Sub: {sub.companyName}</Text> : null}
                {cert.documentUrl ? (
                  <TouchableOpacity
                    style={styles.docChip}
                    onPress={() => openDocument(cert.documentUrl!)}
                    accessibilityRole="button"
                    accessibilityLabel="View document"
                  >
                    <FileText size={11} color={themeColors.accent} strokeWidth={1.75} />
                    <Text style={styles.docChipText}>View document</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </TouchableOpacity>
          );
        })}

        {filtered.length === 0 && (
          <View style={{ minHeight: 340 }}>
            <EmptyState
              icon={<Award size={36} color={themeColors.accent} strokeWidth={1.75} />}
              title={certifications.length === 0 ? 'No certifications yet' : 'Nothing matches that filter'}
              message={certifications.length === 0
                ? 'Track OSHA cards, CPR, First Aid, SST, and trade licenses for your crew and subs. Link each cert to a crew member so it also shows on their profile — and get a heads-up before anything lapses.'
                : `No certifications currently sit in "${filter}". Switch filters above to see the rest.`}
              actionLabel={certifications.length === 0 ? 'Add first certification' : undefined}
              onAction={certifications.length === 0 ? openNew : undefined}
            />
          </View>
        )}

        <TouchableOpacity style={styles.addItemBtn} onPress={openNew} activeOpacity={0.7} testID="add-certification">
          <Plus size={16} color={themeColors.accent} strokeWidth={1.75} />
          <Text style={styles.addItemBtnText}>Add Certification</Text>
        </TouchableOpacity>
      </ScrollView>

      <Modal visible={showForm} transparent animationType="slide" onRequestClose={() => { setShowForm(false); resetForm(); }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalOverlay}>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end' as const }} keyboardShouldPersistTaps="handled">
              <View style={[styles.formCard, { paddingBottom: insets.bottom + 20, maxHeight: '92%' }]}>
                <View style={styles.formHeader}>
                  <Text style={styles.formTitle}>{editing ? 'Edit Certification' : 'New Certification'}</Text>
                  <TouchableOpacity onPress={() => { setShowForm(false); resetForm(); }} accessibilityRole="button" accessibilityLabel="Close">
                    <X size={20} color={themeColors.textMuted} strokeWidth={1.75} />
                  </TouchableOpacity>
                </View>

                <ScrollView style={{ maxHeight: 540 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                  {/* Crew-member picker first — pick a person to anchor the cert. */}
                  <Text style={styles.fieldLabel}>Crew member</Text>
                  {activeMembers.length > 0 ? (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 2 }}>
                      {activeMembers.map((m) => {
                        const active = workerId === m.id;
                        return (
                          <TouchableOpacity
                            key={m.id}
                            style={[styles.memberChip, active && styles.memberChipActive]}
                            onPress={() => pickMember(m)}
                          >
                            <Text style={[styles.memberChipText, active && styles.memberChipTextActive]}>{m.fullName}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </ScrollView>
                  ) : (
                    <Text style={styles.hintText}>No active crew members yet — enter a holder name below.</Text>
                  )}
                  {workerId ? (
                    <TouchableOpacity style={styles.clearMemberBtn} onPress={clearMember} accessibilityRole="button" accessibilityLabel="Unlink crew member">
                      <X size={12} color={themeColors.textSecondary} strokeWidth={1.75} />
                      <Text style={styles.clearMemberText}>Not on the crew — enter name by hand</Text>
                    </TouchableOpacity>
                  ) : null}

                  <Text style={styles.fieldLabel}>Holder name{workerId ? '' : ' *'}</Text>
                  <TextInput
                    style={[styles.input, workerId ? { opacity: 0.6 } : null]}
                    value={holderName}
                    onChangeText={setHolderName}
                    placeholder="Full name"
                    placeholderTextColor={themeColors.textMuted}
                    editable={!workerId}
                  />

                  <Text style={styles.fieldLabel}>Certification type *</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 2 }}>
                    {TYPE_QUICKPICKS.map((qp) => (
                      <TouchableOpacity
                        key={qp}
                        style={[styles.typeChip, type.trim() === qp && styles.typeChipActive]}
                        onPress={() => setType(qp)}
                      >
                        <Text style={[styles.typeChipText, type.trim() === qp && styles.typeChipTextActive]}>{qp}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                  <TextInput style={styles.input} value={type} onChangeText={setType} placeholder="e.g. OSHA 30, Journeyman license" placeholderTextColor={themeColors.textMuted} testID="cert-type-input" />

                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.fieldLabel}>Issued date</Text>
                      <TextInput style={styles.input} value={issuedDate} onChangeText={setIssuedDate} placeholder="YYYY-MM-DD" placeholderTextColor={themeColors.textMuted} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.fieldLabel}>Expires date</Text>
                      <TextInput style={styles.input} value={expiresDate} onChangeText={setExpiresDate} placeholder="YYYY-MM-DD" placeholderTextColor={themeColors.textMuted} />
                    </View>
                  </View>

                  {subcontractors.length > 0 && (
                    <>
                      <Text style={styles.fieldLabel}>Subcontractor (optional)</Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 2 }}>
                        <TouchableOpacity
                          style={[styles.typeChip, !subId && styles.typeChipActive]}
                          onPress={() => setSubId('')}
                        >
                          <Text style={[styles.typeChipText, !subId && styles.typeChipTextActive]}>None</Text>
                        </TouchableOpacity>
                        {subcontractors.map((s) => (
                          <TouchableOpacity
                            key={s.id}
                            style={[styles.typeChip, subId === s.id && styles.typeChipActive]}
                            onPress={() => setSubId(s.id)}
                          >
                            <Text style={[styles.typeChipText, subId === s.id && styles.typeChipTextActive]}>{s.companyName}</Text>
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    </>
                  )}

                  <Text style={styles.fieldLabel}>Document URL (optional)</Text>
                  <TextInput style={styles.input} value={documentUrl} onChangeText={setDocumentUrl} placeholder="https://..." placeholderTextColor={themeColors.textMuted} autoCapitalize="none" keyboardType="url" />
                </ScrollView>

                <View style={styles.formActions}>
                  {editing && (
                    <TouchableOpacity style={styles.deleteBtn} onPress={() => { setShowForm(false); handleDelete(editing); }}>
                      <Trash2 size={16} color={themeColors.danger} strokeWidth={1.75} />
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity style={styles.cancelBtn} onPress={() => { setShowForm(false); resetForm(); }}>
                    <Text style={styles.cancelBtnText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.saveBtn} onPress={handleSave} activeOpacity={0.85} testID="save-certification">
                    <Text style={styles.saveBtnText}>{editing ? 'Update' : 'Save'}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const makeStyles = (themeColors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: themeColors.bg },
  banner: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10, marginHorizontal: 20, marginTop: 16, padding: 14, borderRadius: Tokens.radius.lg, borderWidth: 1 },
  bannerText: { flex: 1, fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: themeColors.text },
  filterRow: { paddingHorizontal: 20, gap: 6, marginTop: 14, marginBottom: 4 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: themeColors.line },
  filterChipText: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: themeColors.textSecondary },
  card: { marginHorizontal: 20, marginTop: 12, backgroundColor: themeColors.surface, borderRadius: Tokens.radius.lg, padding: 16, borderWidth: 1, borderColor: themeColors.line, gap: 8 },
  cardTop: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 10 },
  nameRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, flexWrap: 'wrap' as const },
  cardName: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: themeColors.text, lineHeight: 21 },
  crewTag: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8, backgroundColor: themeColors.accent + '14' },
  crewTagText: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const, color: themeColors.accent },
  cardType: { fontSize: Type.footnote.fontSize, color: themeColors.textSecondary, marginTop: 2 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: Tokens.radius.sm },
  statusBadgeText: { fontSize: Type.caption1.fontSize, fontWeight: '800' as const },
  cardMeta: { fontSize: Type.caption1.fontSize, color: themeColors.textMuted },
  chipRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10, flexWrap: 'wrap' as const },
  subName: { fontSize: Type.caption1.fontSize, color: themeColors.textMuted },
  docChip: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12, backgroundColor: themeColors.accent + '14' },
  docChipText: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const, color: themeColors.accent },
  addItemBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 8, marginHorizontal: 20, marginTop: 16, paddingVertical: 14, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.accent + '12', borderWidth: 1, borderColor: themeColors.accent + '20' },
  addItemBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '600' as const, color: themeColors.accent },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' as const },
  formCard: { backgroundColor: themeColors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 22, gap: 8 },
  formHeader: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, alignItems: 'center' as const, marginBottom: 8 },
  formTitle: { fontSize: Type.title3.fontSize, fontWeight: '700' as const, color: themeColors.text },
  fieldLabel: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: themeColors.textSecondary, marginTop: 8 },
  hintText: { fontSize: Type.caption1.fontSize, color: themeColors.textMuted, marginTop: 4 },
  input: { minHeight: 44, borderRadius: Tokens.radius.card, backgroundColor: themeColors.surfaceAlt, paddingHorizontal: 14, fontSize: Type.subhead.fontSize, color: themeColors.text, marginTop: 4 },
  memberChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: Tokens.radius.md, backgroundColor: themeColors.line },
  memberChipActive: { backgroundColor: themeColors.accent },
  memberChipText: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: themeColors.textSecondary },
  memberChipTextActive: { color: '#fff' },
  clearMemberBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6, alignSelf: 'flex-start' as const, marginTop: 8, paddingHorizontal: 10, paddingVertical: 6, borderRadius: Tokens.radius.sm, backgroundColor: themeColors.line },
  clearMemberText: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: themeColors.textSecondary },
  typeChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: Tokens.radius.md, backgroundColor: themeColors.line },
  typeChipActive: { backgroundColor: themeColors.accent },
  typeChipText: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: themeColors.textSecondary },
  typeChipTextActive: { color: '#fff' },
  formActions: { flexDirection: 'row' as const, gap: 10, marginTop: 12 },
  deleteBtn: { width: 48, minHeight: 48, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.danger + '14', alignItems: 'center' as const, justifyContent: 'center' as const },
  cancelBtn: { flex: 1, minHeight: 48, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.line, alignItems: 'center' as const, justifyContent: 'center' as const },
  cancelBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: themeColors.text },
  saveBtn: { flex: 2, minHeight: 48, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.accent, alignItems: 'center' as const, justifyContent: 'center' as const },
  saveBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: '#fff' },
});
