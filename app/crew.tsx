import React, { useState, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Platform, Modal, KeyboardAvoidingView, ActivityIndicator, Switch,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import {
  Plus, X, ChevronLeft, ChevronRight, IdCard, ShieldCheck,
  UserCheck, ScanLine, Send, Trash2, Camera, Image as ImageIcon, Check,
} from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { useCrew } from '@/contexts/CrewContext';
import { useSafety } from '@/contexts/SafetyContext';
import { useProjects } from '@/contexts/ProjectContext';
import { useAuth } from '@/contexts/AuthContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import EmptyState from '@/components/EmptyState';
import type { CrewMember, IdDocumentType } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { generateUUID } from '@/utils/generateId';
import { verifiedBadge, certExpiryStatus, maskIdLast4, computeIdVerified, type CertExpiryStatus } from '@/utils/crew';
import { scanGovernmentId, sendClaimInvite, type IdScanResult } from '@/utils/crewScan';
import { uploadWorkerIdImage } from '@/utils/storage';
import { checkAILimit, recordAIUsage } from '@/utils/aiRateLimiter';
import { showAlert } from '@/utils/alert';

export default function CrewScreen() {
  const router = useRouter();
  const { canAccess } = useTierAccess();
  const { crewMembers } = useCrew();
  const { user } = useAuth();
  const userId = user?.id;

  // The GC roster is Business-gated. The CLAIMED-WORKER self-edit path is NOT
  // tier-gated: a worker who redeemed a claim link (typically a free user) must
  // be able to view and edit their own profile + control visibility. Route them
  // to a restricted self-view instead of the Business paywall.
  const claimedSelf = useMemo(
    () => (userId ? crewMembers.filter(m => m.claimedByUserId === userId) : []),
    [crewMembers, userId],
  );

  if (!canAccess('crew_management')) {
    if (claimedSelf.length > 0) {
      return <ClaimedWorkerSelfView members={claimedSelf} />;
    }
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

// Ungated self-edit view for a worker who claimed their profile. Renders ONLY
// the rows the current user has claimed and exposes ONLY worker-owned fields
// (phone, email, trades, visibility). GC-owned compliance fields (ID
// verification, claim state) are read-only here and are frozen server-side by
// crew_freeze_ownership_columns, so any stray write can never persist.
function ClaimedWorkerSelfView({ members }: { members: CrewMember[] }) {
  const insets = useSafeAreaInsets();
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { updateCrewMember } = useCrew();

  return (
    <View style={[styles.container, { backgroundColor: themeColors.bg }]}>
      <Stack.Screen options={{ title: 'My Profile' }} />
      <View style={styles.header}>
        <Text style={styles.headerTitle}>My Profile</Text>
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
        {members.map(m => (
          <SelfEditCard key={m.id} member={m} onSave={updateCrewMember} styles={styles} themeColors={themeColors} />
        ))}
      </ScrollView>
    </View>
  );
}

function SelfEditCard({
  member, onSave, styles, themeColors,
}: {
  member: CrewMember;
  onSave: (id: string, changes: Partial<CrewMember>) => void;
  styles: ReturnType<typeof makeStyles>;
  themeColors: ThemeColors;
}) {
  const [phone, setPhone] = useState(member.phone ?? '');
  const [email, setEmail] = useState(member.email ?? '');
  const [tradesText, setTradesText] = useState(member.trades.join(', '));
  const [isPublic, setIsPublic] = useState(member.isPublic);

  const handleSave = useCallback(() => {
    onSave(member.id, {
      phone: phone.trim() || undefined,
      email: email.trim() || undefined,
      trades: tradesText.split(',').map(t => t.trim()).filter(Boolean),
      isPublic,
    });
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    showAlert('Saved', 'Your profile has been updated.');
  }, [member.id, phone, email, tradesText, isPublic, onSave]);

  return (
    <View style={[styles.crewCard, { flexDirection: 'column', alignItems: 'stretch', gap: 14 }]}>
      <View>
        <Text style={styles.crewName}>{member.fullName}</Text>
        <View style={styles.chipRow}>
          {verifiedBadge(member) === 'id_verified' && (
            <View style={styles.verifiedChip}>
              <ShieldCheck size={12} color={themeColors.accent} strokeWidth={2} />
              <Text style={styles.verifiedChipText}>ID Verified</Text>
            </View>
          )}
          <View style={styles.claimedChip}>
            <UserCheck size={12} color={themeColors.success} strokeWidth={2} />
            <Text style={styles.claimedChipText}>Claimed</Text>
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.fieldLabel}>Phone</Text>
        <TextInput style={styles.input} value={phone} onChangeText={setPhone} placeholder="(555) 123-4567" placeholderTextColor={themeColors.textMuted} keyboardType="phone-pad" />
        <Text style={styles.fieldLabel}>Email</Text>
        <TextInput style={styles.input} value={email} onChangeText={setEmail} placeholder="name@email.com" placeholderTextColor={themeColors.textMuted} keyboardType="email-address" autoCapitalize="none" />
        <Text style={styles.fieldLabel}>Trades (comma-separated)</Text>
        <TextInput style={styles.input} value={tradesText} onChangeText={setTradesText} placeholder="e.g. Electrical, Framing" placeholderTextColor={themeColors.textMuted} />
      </View>

      <View style={styles.retainRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.retainLabel}>Show me for hire</Text>
          <Text style={styles.retainHelp}>Controls whether your profile can appear in the hiring marketplace.</Text>
        </View>
        <Switch
          value={isPublic}
          onValueChange={setIsPublic}
          trackColor={{ true: themeColors.accent, false: themeColors.line }}
          testID="self-visibility-switch"
        />
      </View>

      <TouchableOpacity style={[styles.saveBtn, { flex: 0 }]} onPress={handleSave} activeOpacity={0.85} testID="self-save">
        <Text style={styles.saveBtnText}>Save</Text>
      </TouchableOpacity>
    </View>
  );
}

function CrewScreenInner() {
  const insets = useSafeAreaInsets();
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { crewMembers, addCrewMember, updateCrewMember, deleteCrewMember, getCrewMember, startClaimInvite } = useCrew();
  const { getCertificationsForWorker } = useSafety();
  const { projects } = useProjects();
  const auth = useAuth();
  const subscription = useSubscription();

  const [detailId, setDetailId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  // Add-form fields
  const [fullName, setFullName] = useState('');
  const [tradesText, setTradesText] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');

  // ── ID-scan sub-flow state ─────────────────────────────────────────────
  // SECURITY INVARIANT: the raw ID base64 is NEVER stored in state — it's passed
  // straight into runScan() as an argument and discarded when that call returns.
  // scanFields.idNumberFull is the only other place the raw ID lives, only in
  // component state, never written to updateCrewMember except via maskIdLast4().
  // Every close/cancel path below clears capturedUri/scanFields so nothing lingers.
  const [scanStage, setScanStage] = useState<'closed' | 'consent' | 'capture' | 'scanning' | 'review'>('closed');
  const [consentChecked, setConsentChecked] = useState(false);
  const [capturedUri, setCapturedUri] = useState<string | null>(null);
  const [scanFields, setScanFields] = useState<IdScanResult | null>(null);
  const [retainImage, setRetainImage] = useState(false); // default OFF = extract-then-purge
  const [scanTargetId, setScanTargetId] = useState<string | null>(null);

  const member = useMemo(() => (detailId ? getCrewMember(detailId) : null), [detailId, getCrewMember]);

  // Fully reset the sub-flow and purge any raw ID material from memory.
  const closeScan = useCallback(() => {
    setScanStage('closed');
    setConsentChecked(false);
    setCapturedUri(null);
    setScanFields(null);
    setRetainImage(false);
    setScanTargetId(null);
  }, []);

  const openScan = useCallback((memberId: string) => {
    setScanTargetId(memberId);
    setConsentChecked(false);
    setCapturedUri(null);
    setScanFields(null);
    setRetainImage(false);
    setScanStage('consent');
  }, []);

  const runScan = useCallback(async (base64: string) => {
    if (!base64) return;
    const { tier } = subscription; // useSubscription()
    // Fast-path DAILY pre-check; the authoritative cap is the server MONTHLY
    // cap (MONTHLY_CAPS[tier].scan_credential). scanGovernmentId re-throws the
    // server's "Monthly credential-scan limit reached (…)" verbatim, which the
    // catch below surfaces — do NOT branch on a daily counter to "fix" this.
    const limit = await checkAILimit(tier, 'smart', 'scanCredential');
    if (!limit.allowed) {
      showAlert('Scan limit reached', limit.message ?? 'Upgrade to keep scanning.');
      return;
    }
    setScanStage('scanning');
    try {
      const fields = await scanGovernmentId(base64);
      await recordAIUsage('smart', 'scanCredential');
      setScanFields(fields);
      setScanStage('review');
    } catch (e) {
      showAlert('Scan failed', e instanceof Error ? e.message : 'Try a clearer, well-lit photo.');
      setScanStage('capture');
    }
  }, [subscription]);

  const handleTakeIdPhoto = useCallback(async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      showAlert('Camera access needed', 'Grant camera permission in Settings.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.5, base64: true });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    setCapturedUri(asset.uri);
    void runScan(asset.base64 ?? '');
  }, [runScan]);

  const handleChooseIdPhoto = useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      showAlert('Photo access needed', 'Grant photo access in Settings to pick a photo.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.5,
      base64: true,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    setCapturedUri(asset.uri);
    void runScan(asset.base64 ?? '');
  }, [runScan]);

  const handleSaveScan = useCallback(async () => {
    if (!scanTargetId || !scanFields) return;
    const { user } = auth; // useAuth()
    // Derive the masked last-4 ONCE from the raw number, then never persist raw.
    const maskedLast4 = maskIdLast4(scanFields.idNumberFull);
    const verified = computeIdVerified({ scanCompleted: true, userConfirmed: true });
    let idImagePath: string | undefined;
    if (retainImage && capturedUri && user?.id) {
      // Opt-in retain: uploads to the private worker-ids bucket, returns a PATH.
      idImagePath = (await uploadWorkerIdImage(user.id, scanTargetId, capturedUri)) ?? undefined;
    }
    updateCrewMember(scanTargetId, {
      idVerified: verified,
      idType: scanFields.idType,
      idMaskedLast4: maskedLast4,
      idExpiry: scanFields.expiry || undefined,
      idIssuer: scanFields.issuer || undefined,
      idScannedAt: new Date().toISOString(),
      idImagePath, // undefined on the default purge path — raw image never uploaded
    });
    // Purge the in-memory raw number/image — never persisted.
    setCapturedUri(null); setScanFields(null);
    setScanStage('closed'); setConsentChecked(false); setRetainImage(false); setScanTargetId(null);
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [scanTargetId, scanFields, retainImage, capturedUri, auth, updateCrewMember]);

  const handleAdd = useCallback(() => {
    if (!fullName.trim()) { showAlert('Name required'); return; }
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

  const handleInvite = useCallback(async () => {
    if (!member) return;
    if (!member.email) { showAlert('Email needed', 'Add an email to this crew member before inviting.'); return; }
    const token = startClaimInvite(member.id);
    if (!token) { showAlert('Could not start invite'); return; }
    try {
      await sendClaimInvite(member.email, token);
      showAlert('Invite sent', `${member.fullName} can now claim their profile from their email.`);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      showAlert('Invite failed', e instanceof Error ? e.message : 'Try again.');
    }
  }, [member, startClaimInvite]);

  const handleDelete = useCallback(() => {
    if (!member) return;
    showAlert('Delete crew member', `Remove ${member.fullName} from your roster? Any attached ID is purged.`, [
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
                          onPress={() => openScan(member.id)}
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

                  {/* Certifications — person-anchored via Certification.workerId === member.id (Safety Wave B). */}
                  <View style={styles.section}>
                    <Text style={styles.sectionLabel}>Certifications</Text>
                    {(() => {
                      const certs = getCertificationsForWorker(member.id);
                      if (certs.length === 0) {
                        return <Text style={styles.emptyRowText}>No certifications on file yet.</Text>;
                      }
                      return certs.map(cert => {
                        const status = certExpiryStatus(cert.expiresDate, today);
                        return (
                          <View key={cert.id} style={styles.certRow}>
                            <Text style={styles.certName} numberOfLines={1}>{cert.type}</Text>
                            <Text style={[styles.certStatus, CERT_STATUS_STYLE(themeColors)[status]]}>{CERT_STATUS_LABEL[status]}</Text>
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

      {/* ── ID-scan sub-flow (consent → capture → scanning → review) ─────── */}
      <Modal
        visible={scanStage !== 'closed'}
        transparent
        animationType="slide"
        onRequestClose={closeScan}
      >
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalOverlay}>
            <View style={[styles.scanCard, { paddingBottom: insets.bottom + 20 }]}>
              <View style={styles.formHeader}>
                <TouchableOpacity onPress={closeScan} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close scan">
                  <ChevronLeft size={22} color={themeColors.text} strokeWidth={1.75} />
                </TouchableOpacity>
                <Text style={styles.formTitle}>Scan ID</Text>
                <TouchableOpacity onPress={closeScan} hitSlop={8} accessibilityRole="button" accessibilityLabel="Cancel scan">
                  <X size={20} color={themeColors.textMuted} strokeWidth={1.75} />
                </TouchableOpacity>
              </View>

              {/* Stage: consent */}
              {scanStage === 'consent' ? (
                <View style={{ gap: 14 }}>
                  <TouchableOpacity
                    style={styles.consentRow}
                    onPress={() => setConsentChecked(v => !v)}
                    activeOpacity={0.8}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: consentChecked }}
                    testID="scan-consent-checkbox"
                  >
                    <View style={[styles.checkbox, consentChecked && styles.checkboxOn]}>
                      {consentChecked ? <Check size={14} color="#FFFFFF" strokeWidth={3} /> : null}
                    </View>
                    <Text style={styles.consentText}>
                      I have this person&apos;s consent to scan and store their ID information.
                    </Text>
                  </TouchableOpacity>
                  <Text style={styles.disclaimer}>
                    MAGE captures and attaches an ID. It does not legally verify identity or work eligibility.
                  </Text>
                  <TouchableOpacity
                    style={[styles.saveBtn, !consentChecked && styles.saveBtnDisabled]}
                    onPress={() => setScanStage('capture')}
                    disabled={!consentChecked}
                    activeOpacity={0.85}
                    testID="scan-consent-continue"
                  >
                    <Text style={styles.saveBtnText}>Continue</Text>
                  </TouchableOpacity>
                </View>
              ) : null}

              {/* Stage: capture */}
              {scanStage === 'capture' ? (
                <View style={{ gap: 12 }}>
                  <Text style={styles.captureHint}>Use a clear, well-lit photo of the government ID.</Text>
                  <TouchableOpacity style={styles.captureBtn} onPress={handleTakeIdPhoto} activeOpacity={0.85} testID="scan-take-photo">
                    <Camera size={18} color={themeColors.accent} strokeWidth={1.75} />
                    <Text style={styles.captureBtnText}>Take photo</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.captureBtn} onPress={handleChooseIdPhoto} activeOpacity={0.85} testID="scan-choose-photo">
                    <ImageIcon size={18} color={themeColors.accent} strokeWidth={1.75} />
                    <Text style={styles.captureBtnText}>Choose photo</Text>
                  </TouchableOpacity>
                </View>
              ) : null}

              {/* Stage: scanning */}
              {scanStage === 'scanning' ? (
                <View style={styles.scanningBox}>
                  <ActivityIndicator size="large" color={themeColors.accent} />
                  <Text style={styles.scanningText}>Reading the ID…</Text>
                </View>
              ) : null}

              {/* Stage: review */}
              {scanStage === 'review' && scanFields ? (
                <ScrollView style={{ maxHeight: 460 }} contentContainerStyle={{ gap: 8 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                  <Text style={styles.fieldLabel}>Full name</Text>
                  <TextInput
                    style={styles.input}
                    value={scanFields.fullName}
                    onChangeText={t => setScanFields(f => (f ? { ...f, fullName: t } : f))}
                    placeholder="Full name"
                    placeholderTextColor={themeColors.textMuted}
                  />

                  <Text style={styles.fieldLabel}>ID type</Text>
                  <View style={styles.chipWrap}>
                    {(ID_TYPE_OPTIONS).map(opt => {
                      const on = scanFields.idType === opt.value;
                      return (
                        <TouchableOpacity
                          key={opt.value}
                          style={[styles.assignChip, on && styles.assignChipActive]}
                          onPress={() => setScanFields(f => (f ? { ...f, idType: opt.value } : f))}
                          activeOpacity={0.8}
                        >
                          <Text style={[styles.assignChipText, on && styles.assignChipTextActive]}>{opt.label}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  <Text style={styles.fieldLabel}>ID number</Text>
                  <TextInput
                    style={styles.input}
                    value={scanFields.idNumberFull}
                    onChangeText={t => setScanFields(f => (f ? { ...f, idNumberFull: t } : f))}
                    placeholder="ID number"
                    placeholderTextColor={themeColors.textMuted}
                    autoCapitalize="characters"
                  />

                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.fieldLabel}>Expiry</Text>
                      <TextInput
                        style={styles.input}
                        value={scanFields.expiry}
                        onChangeText={t => setScanFields(f => (f ? { ...f, expiry: t } : f))}
                        placeholder="YYYY-MM-DD"
                        placeholderTextColor={themeColors.textMuted}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.fieldLabel}>Issuer</Text>
                      <TextInput
                        style={styles.input}
                        value={scanFields.issuer}
                        onChangeText={t => setScanFields(f => (f ? { ...f, issuer: t } : f))}
                        placeholder="e.g. CA DMV"
                        placeholderTextColor={themeColors.textMuted}
                      />
                    </View>
                  </View>

                  <View style={styles.retainRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.retainLabel}>Retain original image</Text>
                      <Text style={styles.retainHelp}>
                        Off = we keep only the masked last 4 and expiry; the photo is discarded.
                      </Text>
                    </View>
                    <Switch
                      value={retainImage}
                      onValueChange={setRetainImage}
                      trackColor={{ true: themeColors.accent, false: themeColors.line }}
                      testID="scan-retain-switch"
                    />
                  </View>

                  <TouchableOpacity style={styles.saveBtn} onPress={handleSaveScan} activeOpacity={0.85} testID="scan-save">
                    <Text style={styles.saveBtnText}>Save</Text>
                  </TouchableOpacity>
                </ScrollView>
              ) : null}
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const ID_TYPE_OPTIONS: { value: IdDocumentType; label: string }[] = [
  { value: 'drivers_license', label: "Driver's license" },
  { value: 'state_id', label: 'State ID' },
  { value: 'passport', label: 'Passport' },
  { value: 'other', label: 'Other' },
];

// Human-readable cert-expiry labels + status coloring for the crew detail view.
const CERT_STATUS_LABEL: Record<CertExpiryStatus, string> = {
  none: 'No expiry',
  valid: 'Valid',
  expiring: 'Expiring soon',
  expired: 'Expired',
};
const CERT_STATUS_STYLE = (t: ThemeColors): Record<CertExpiryStatus, { color: string }> => ({
  none: { color: t.textSecondary },
  valid: { color: t.success },
  expiring: { color: t.accent },
  expired: { color: t.danger },
});

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
  saveBtnDisabled: { opacity: 0.4 },
  saveBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: '#FFFFFF' },

  // ID-scan sub-flow
  scanCard: { backgroundColor: themeColors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 22, gap: 12 },
  consentRow: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 12 },
  checkbox: {
    width: 24, height: 24, borderRadius: 7, borderWidth: 2, borderColor: themeColors.line,
    alignItems: 'center' as const, justifyContent: 'center' as const, marginTop: 1,
  },
  checkboxOn: { backgroundColor: themeColors.accent, borderColor: themeColors.accent },
  consentText: { flex: 1, fontSize: Type.subhead.fontSize, color: themeColors.text, lineHeight: 21 },
  captureHint: { fontSize: Type.footnote.fontSize, color: themeColors.textSecondary, marginBottom: 2 },
  captureBtn: {
    flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 8,
    paddingVertical: 14, borderRadius: Tokens.radius.lg,
    backgroundColor: themeColors.accentSoft, borderWidth: 1, borderColor: themeColors.accent + '20',
  },
  captureBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: themeColors.accent },
  scanningBox: { alignItems: 'center' as const, justifyContent: 'center' as const, gap: 14, paddingVertical: 40 },
  scanningText: { fontSize: Type.subhead.fontSize, fontWeight: '600' as const, color: themeColors.textSecondary },
  retainRow: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12,
    backgroundColor: themeColors.surfaceAlt, borderRadius: Tokens.radius.md, padding: 12, marginTop: 8,
  },
  retainLabel: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: themeColors.text },
  retainHelp: { fontSize: Type.caption1.fontSize, color: themeColors.textMuted, lineHeight: 16, marginTop: 2 },

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
