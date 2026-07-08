import React, { useState, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  Alert, Platform, Modal, KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  Plus, X, ChevronLeft, ChevronRight, IdCard, ShieldCheck,
  UserCheck, ScanLine, Send, Trash2,
} from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { useCrew } from '@/contexts/CrewContext';
import { useProjects } from '@/contexts/ProjectContext';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import EmptyState from '@/components/EmptyState';
import type { CrewMember } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { generateUUID } from '@/utils/generateId';
import { verifiedBadge, certExpiryStatus } from '@/utils/crew';

export default function CrewScreen() {
  const router = useRouter();
  const { canAccess } = useTierAccess();
  if (!canAccess('crew_management')) {
    return (
      <Paywall
        visible={true}
        feature="Crew Management"
        requiredTier="business"
        onClose={() => router.back()}
      />
    );
  }
  return <CrewScreenInner />;
}

function CrewScreenInner() {
  const insets = useSafeAreaInsets();
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { crewMembers, addCrewMember, updateCrewMember, deleteCrewMember, getCrewMember, startClaimInvite } = useCrew();
  const { projects } = useProjects();

  const [detailId, setDetailId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  // Add-form fields
  const [fullName, setFullName] = useState('');
  const [tradesText, setTradesText] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');

  const member = useMemo(() => (detailId ? getCrewMember(detailId) : null), [detailId, getCrewMember]);

  const handleAdd = useCallback(() => {
    if (!fullName.trim()) { Alert.alert('Name required'); return; }
    const now = new Date().toISOString();
    addCrewMember({
      id: generateUUID(),
      companyUserId: '', // CrewContext.addCrewMember stamps the owning user id.
      createdAt: now, updatedAt: now,
      fullName: fullName.trim(),
      trades: tradesText.split(',').map(t => t.trim()).filter(Boolean),
      phone: phone.trim() || undefined,
      email: email.trim() || undefined,
      status: 'active',
      idVerified: false,
      isPublic: false,
      projectIds: [],
    });
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setAddOpen(false); setFullName(''); setTradesText(''); setPhone(''); setEmail('');
  }, [fullName, tradesText, phone, email, addCrewMember]);

  const handleToggleProject = useCallback((projectId: string) => {
    if (!member) return;
    const has = member.projectIds.includes(projectId);
    const projectIds = has
      ? member.projectIds.filter(id => id !== projectId)
      : [...member.projectIds, projectId];
    updateCrewMember(member.id, { projectIds });
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, [member, updateCrewMember]);

  const handleInvite = useCallback(() => {
    if (!member) return;
    const token = startClaimInvite(member.id);
    if (token) {
      Alert.alert(
        'Invite ready',
        `A claim invite has been prepared for ${member.fullName}. Share the magic link so they can claim and manage their own profile.`,
      );
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  }, [member, startClaimInvite]);

  const handleDelete = useCallback(() => {
    if (!member) return;
    Alert.alert('Delete crew member', `Remove ${member.fullName} from your roster? Any attached ID is purged.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => { deleteCrewMember(member.id); setDetailId(null); },
      },
    ]);
  }, [member, deleteCrewMember]);

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  return (
    <View style={[styles.container, { backgroundColor: themeColors.bg }]}>
      <Stack.Screen options={{ title: 'Crew' }} />

      <View style={styles.header}>
        <Text style={styles.headerTitle}>Crew</Text>
        <TouchableOpacity
          style={styles.fab}
          onPress={() => setAddOpen(true)}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Add crew member"
          testID="add-crew-member"
        >
          <Plus size={20} color="#FFFFFF" strokeWidth={2} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
        {crewMembers.length === 0 ? (
          <View style={{ minHeight: 420 }}>
            <EmptyState
              icon={<IdCard size={36} color={themeColors.accent} strokeWidth={1.75} />}
              title="No crew yet"
              message="Add your first crew member to build a verified roster."
              actionLabel="Add crew member"
              onAction={() => setAddOpen(true)}
            />
          </View>
        ) : (
          crewMembers.map(m => {
            const badge = verifiedBadge(m);
            return (
              <TouchableOpacity
                key={m.id}
                style={styles.crewCard}
                onPress={() => setDetailId(m.id)}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel={`Open ${m.fullName}`}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.crewName}>{m.fullName}</Text>
                  {m.trades.length > 0 ? (
                    <Text style={styles.crewTrades}>{m.trades.join(' · ')}</Text>
                  ) : null}
                  <View style={styles.chipRow}>
                    {badge === 'id_verified' && (
                      <View style={styles.verifiedChip}>
                        <ShieldCheck size={12} color={themeColors.accent} strokeWidth={2} />
                        <Text style={styles.verifiedChipText}>ID Verified</Text>
                      </View>
                    )}
                    {m.claimedByUserId ? (
                      <View style={styles.claimedChip}>
                        <UserCheck size={12} color={themeColors.success} strokeWidth={2} />
                        <Text style={styles.claimedChipText}>Claimed</Text>
                      </View>
                    ) : null}
                  </View>
                </View>
                <ChevronRight size={18} color={themeColors.textMuted} strokeWidth={1.75} />
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>

      {/* ── Add crew member ─────────────────────────────────────── */}
      <Modal visible={addOpen} transparent animationType="slide" onRequestClose={() => setAddOpen(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalOverlay}>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end' as const }} keyboardShouldPersistTaps="handled">
              <View style={[styles.formCard, { paddingBottom: insets.bottom + 20 }]}>
                <View style={styles.formHeader}>
                  <TouchableOpacity onPress={() => setAddOpen(false)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back">
                    <ChevronLeft size={22} color={themeColors.text} strokeWidth={1.75} />
                  </TouchableOpacity>
                  <Text style={styles.formTitle}>Add crew member</Text>
                  <TouchableOpacity onPress={() => setAddOpen(false)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
                    <X size={20} color={themeColors.textMuted} strokeWidth={1.75} />
                  </TouchableOpacity>
                </View>

                <Text style={styles.fieldLabel}>Full name *</Text>
                <TextInput style={styles.input} value={fullName} onChangeText={setFullName} placeholder="e.g. Maria Gonzalez" placeholderTextColor={themeColors.textMuted} testID="crew-name-input" />

                <Text style={styles.fieldLabel}>Trades (comma-separated)</Text>
                <TextInput style={styles.input} value={tradesText} onChangeText={setTradesText} placeholder="e.g. Electrical, Framing" placeholderTextColor={themeColors.textMuted} />

                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>Phone</Text>
                    <TextInput style={styles.input} value={phone} onChangeText={setPhone} placeholder="(555) 123-4567" placeholderTextColor={themeColors.textMuted} keyboardType="phone-pad" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>Email</Text>
                    <TextInput style={styles.input} value={email} onChangeText={setEmail} placeholder="name@email.com" placeholderTextColor={themeColors.textMuted} keyboardType="email-address" autoCapitalize="none" />
                  </View>
                </View>

                <View style={styles.formActions}>
                  <TouchableOpacity style={styles.cancelBtn} onPress={() => setAddOpen(false)}>
                    <Text style={styles.cancelBtnText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.saveBtn} onPress={handleAdd} activeOpacity={0.85} testID="save-crew-member">
                    <Text style={styles.saveBtnText}>Add member</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Member detail ───────────────────────────────────────── */}
      <Modal visible={detailId !== null} transparent animationType="slide" onRequestClose={() => setDetailId(null)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.detailCard, { paddingBottom: insets.bottom + 20, maxHeight: '92%' }]}>
            {member ? (
              <>
                <View style={styles.detailHeader}>
                  <TouchableOpacity onPress={() => setDetailId(null)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back">
                    <ChevronLeft size={24} color={themeColors.text} strokeWidth={1.75} />
                  </TouchableOpacity>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.detailName} numberOfLines={1}>{member.fullName}</Text>
                    {member.trades.length > 0 ? (
                      <Text style={styles.detailTrades} numberOfLines={1}>{member.trades.join(' · ')}</Text>
                    ) : null}
                  </View>
                  <View style={[styles.statusPill, member.status === 'active' ? styles.statusPillActive : styles.statusPillInactive]}>
                    <Text style={[styles.statusPillText, { color: member.status === 'active' ? themeColors.success : themeColors.textMuted }]}>
                      {member.status === 'active' ? 'Active' : 'Inactive'}
                    </Text>
                  </View>
                </View>

                <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 12, gap: 18 }} showsVerticalScrollIndicator={false}>
                  {/* Identity */}
                  <View style={styles.section}>
                    <Text style={styles.sectionLabel}>Identity</Text>
                    {verifiedBadge(member) === 'id_verified' ? (
                      <View style={styles.identityVerifiedRow}>
                        <ShieldCheck size={16} color={themeColors.accent} strokeWidth={2} />
                        <Text style={styles.identityVerifiedText}>
                          ID Verified — {member.idIssuer ?? 'ID'} ····{member.idMaskedLast4}
                          {member.idExpiry ? `, exp ${member.idExpiry}` : ''}
                        </Text>
                      </View>
                    ) : (
                      <>
                        <Text style={styles.identityMutedText}>ID not verified</Text>
                        <TouchableOpacity
                          style={styles.scanBtn}
                          onPress={() => {
                            // Task 9 opens the consent → capture → scan → review sub-flow.
                            Alert.alert('Scan ID', 'ID scanning opens in the next step of this flow.');
                          }}
                          activeOpacity={0.85}
                          testID="scan-id"
                        >
                          <ScanLine size={16} color={themeColors.accent} strokeWidth={1.75} />
                          <Text style={styles.scanBtnText}>Scan ID</Text>
                        </TouchableOpacity>
                      </>
                    )}
                    <Text style={styles.disclaimer}>
                      MAGE captures and attaches an ID. It does not legally verify identity or work eligibility.
                    </Text>
                  </View>

                  {/* Certifications */}
                  <View style={styles.section}>
                    <Text style={styles.sectionLabel}>Certifications</Text>
                    {/* Safety Wave B populates via Certification.workerId === member.id; render certExpiryStatus(cert.expiresDate, today) badges here. */}
                    {(() => {
                      const certs: { id: string; name: string; expiresDate?: string }[] = [];
                      if (certs.length === 0) {
                        return <Text style={styles.emptyRowText}>No certifications on file yet.</Text>;
                      }
                      return certs.map(cert => {
                        const status = certExpiryStatus(cert.expiresDate, today);
                        return (
                          <View key={cert.id} style={styles.certRow}>
                            <Text style={styles.certName}>{cert.name}</Text>
                            <Text style={styles.certStatus}>{status}</Text>
                          </View>
                        );
                      });
                    })()}
                  </View>

                  {/* Assigned projects */}
                  <View style={styles.section}>
                    <Text style={styles.sectionLabel}>Assigned projects</Text>
                    {member.projectIds.length > 0 ? (
                      <View style={styles.chipWrap}>
                        {projects.filter(p => member.projectIds.includes(p.id)).map(p => (
                          <View key={p.id} style={styles.projectChip}>
                            <Text style={styles.projectChipText}>{p.name}</Text>
                          </View>
                        ))}
                      </View>
                    ) : (
                      <Text style={styles.emptyRowText}>Not assigned to any project.</Text>
                    )}
                    {projects.length > 0 ? (
                      <>
                        <Text style={[styles.fieldLabel, { marginTop: 10 }]}>Assign to project</Text>
                        <View style={styles.chipWrap}>
                          {projects.map(p => {
                            const on = member.projectIds.includes(p.id);
                            return (
                              <TouchableOpacity
                                key={p.id}
                                style={[styles.assignChip, on && styles.assignChipActive]}
                                onPress={() => handleToggleProject(p.id)}
                                activeOpacity={0.8}
                              >
                                <Text style={[styles.assignChipText, on && styles.assignChipTextActive]} numberOfLines={1}>{p.name}</Text>
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      </>
                    ) : null}
                  </View>

                  {/* Claim */}
                  <View style={styles.section}>
                    <Text style={styles.sectionLabel}>Claim</Text>
                    {member.claimedByUserId ? (
                      <View style={styles.claimedRow}>
                        <UserCheck size={16} color={themeColors.success} strokeWidth={2} />
                        <Text style={styles.claimedRowText}>Claimed by this crew member.</Text>
                      </View>
                    ) : (
                      <TouchableOpacity style={styles.inviteBtn} onPress={handleInvite} activeOpacity={0.85} testID="invite-claim">
                        <Send size={16} color="#FFFFFF" strokeWidth={1.75} />
                        <Text style={styles.inviteBtnText}>Invite to claim</Text>
                      </TouchableOpacity>
                    )}
                  </View>

                  {/* Delete */}
                  <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete} activeOpacity={0.85} testID="delete-crew-member">
                    <Trash2 size={16} color={themeColors.danger} strokeWidth={1.75} />
                    <Text style={styles.deleteBtnText}>Delete crew member</Text>
                  </TouchableOpacity>
                </ScrollView>
              </>
            ) : null}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = (themeColors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: themeColors.bg },
  header: {
    flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const,
    paddingHorizontal: 20, paddingTop: 12, paddingBottom: 12,
  },
  headerTitle: { fontSize: Type.title2.fontSize, fontWeight: '800' as const, color: themeColors.text, letterSpacing: -0.4 },
  fab: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: themeColors.accent,
    alignItems: 'center' as const, justifyContent: 'center' as const,
  },
  crewCard: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12,
    marginHorizontal: 20, marginBottom: 10,
    backgroundColor: themeColors.surface, borderRadius: Tokens.radius.lg,
    padding: 16, borderWidth: 1, borderColor: themeColors.line,
  },
  crewName: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: themeColors.text },
  crewTrades: { fontSize: Type.footnote.fontSize, color: themeColors.textSecondary, marginTop: 2 },
  chipRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 6, marginTop: 8 },
  verifiedChip: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12,
    backgroundColor: themeColors.accentSoft,
  },
  verifiedChipText: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const, color: themeColors.accent },
  claimedChip: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12,
    backgroundColor: themeColors.successSoft,
  },
  claimedChipText: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const, color: themeColors.success },

  // Modal scaffolding
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' as const },
  formCard: { backgroundColor: themeColors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 22, gap: 8 },
  formHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, marginBottom: 8, gap: 12 },
  formTitle: { flex: 1, fontSize: Type.title3.fontSize, fontWeight: '700' as const, color: themeColors.text, textAlign: 'center' as const },
  fieldLabel: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: themeColors.textSecondary, marginTop: 4 },
  input: { minHeight: 44, borderRadius: Tokens.radius.card, backgroundColor: themeColors.surfaceAlt, paddingHorizontal: 14, fontSize: Type.subhead.fontSize, color: themeColors.text },
  formActions: { flexDirection: 'row' as const, gap: 10, marginTop: 16 },
  cancelBtn: { flex: 1, minHeight: 48, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.line, alignItems: 'center' as const, justifyContent: 'center' as const },
  cancelBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: themeColors.text },
  saveBtn: { flex: 2, minHeight: 48, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.accent, alignItems: 'center' as const, justifyContent: 'center' as const },
  saveBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: '#FFFFFF' },

  // Detail
  detailCard: { backgroundColor: themeColors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 22 },
  detailHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12, marginBottom: 16 },
  detailName: { fontSize: Type.title3.fontSize, fontWeight: '800' as const, color: themeColors.text, letterSpacing: -0.3 },
  detailTrades: { fontSize: Type.footnote.fontSize, color: themeColors.textSecondary, marginTop: 2 },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  statusPillActive: { backgroundColor: themeColors.successSoft },
  statusPillInactive: { backgroundColor: themeColors.line },
  statusPillText: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const },
  section: { gap: 8 },
  sectionLabel: { fontSize: 11, fontWeight: '800' as const, color: themeColors.textMuted, letterSpacing: 0.4, textTransform: 'uppercase' as const },
  identityVerifiedRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, backgroundColor: themeColors.accentSoft, borderRadius: Tokens.radius.md, padding: 12 },
  identityVerifiedText: { flex: 1, fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: themeColors.text },
  identityMutedText: { fontSize: Type.subhead.fontSize, color: themeColors.textMuted },
  scanBtn: {
    flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 8,
    marginTop: 4, paddingVertical: 12, borderRadius: Tokens.radius.lg,
    backgroundColor: themeColors.accentSoft, borderWidth: 1, borderColor: themeColors.accent + '20',
  },
  scanBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: themeColors.accent },
  disclaimer: { fontSize: Type.caption1.fontSize, color: themeColors.textMuted, lineHeight: 17, fontStyle: 'italic' as const, marginTop: 4 },
  certRow: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, paddingVertical: 8 },
  certName: { fontSize: Type.subhead.fontSize, color: themeColors.text },
  certStatus: { fontSize: Type.caption1.fontSize, fontWeight: '700' as const, color: themeColors.textSecondary },
  emptyRowText: { fontSize: Type.footnote.fontSize, color: themeColors.textMuted },
  chipWrap: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 6 },
  projectChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, backgroundColor: themeColors.accentSoft },
  projectChipText: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: themeColors.accent },
  assignChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, backgroundColor: themeColors.line, maxWidth: 200 },
  assignChipActive: { backgroundColor: themeColors.accent },
  assignChipText: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: themeColors.textSecondary },
  assignChipTextActive: { color: '#FFFFFF' },
  claimedRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, backgroundColor: themeColors.successSoft, borderRadius: Tokens.radius.md, padding: 12 },
  claimedRowText: { flex: 1, fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: themeColors.text },
  inviteBtn: {
    flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 8,
    paddingVertical: 14, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.accent,
  },
  inviteBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: '#FFFFFF' },
  deleteBtn: {
    flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 8,
    paddingVertical: 14, borderRadius: Tokens.radius.lg,
    backgroundColor: themeColors.danger + '12', borderWidth: 1, borderColor: themeColors.danger + '20',
  },
  deleteBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: themeColors.danger },
});
