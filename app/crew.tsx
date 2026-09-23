import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Platform, Modal, KeyboardAvoidingView, Switch,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import { CraneSvg } from '@/components/CraneLoader';
import { useRouter, Stack, useFocusEffect } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import {
  Plus, X, ChevronLeft, ChevronRight, IdCard, ShieldCheck,
  UserCheck, ScanLine, Send, Trash2, Camera, Image as ImageIcon, Check,
  AlertTriangle, Pencil,
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
import { verifiedBadge, certExpiryStatus, maskIdLast4, computeIdVerified } from '@/utils/crew';
import { idExpiredLabel, crewCertRowStatus, type CrewCertRowStatus } from '@/utils/crew/verifiedBadge';
import { scanGovernmentId, sendClaimInvite, type IdScanResult } from '@/utils/crewScan';
import { uploadWorkerIdImage, deleteStorageFile } from '@/utils/storage';
import { todayCalendarDay } from '@/utils/calendarDate';
import { HIRE_ENABLED } from '@/contexts/HireContext';
import { edgeErrorCode } from '@/utils/edgeError';
import { checkAILimit, recordAIUsage } from '@/utils/aiRateLimiter';
import { showAlert, type AlertButton } from '@/utils/alert';

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

  // Re-read the roster every time Crew gains focus (#70). CrewProvider lives
  // at the app root with no refetch-on-focus on native, so the GC's copy could
  // be hours old — a claim made on the worker's phone, or an ID scanned on the
  // GC's other device, was invisible here, and the next edit was made against
  // the stale copy. (The server now pins claim state and older ID scans on
  // every write — 20260923160000 — so this is about what he SEES before he
  // acts, not the last line of defence.)
  const queryClient = useQueryClient();
  useFocusEffect(useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['crew_members'] });
  }, [queryClient]));

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
//
// Exported (#74): app/claim-crew.tsx renders it inline on success. /crew is
// behind the persona gate, so a brand-new worker sent here after claiming was
// bounced into contractor setup and never found the profile he'd just been
// told he could edit. `embedded` skips this route's header title; `header` /
// `footer` render inside the same scroll.
export function ClaimedWorkerSelfView({
  members, embedded = false, header, footer,
}: {
  members: CrewMember[];
  embedded?: boolean;
  header?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { updateCrewMember } = useCrew();

  return (
    <View style={[styles.container, { backgroundColor: themeColors.bg }]}>
      {/* Runtime audit 2026-09-06, VIS-19: the native header (declared for
          this route in app/_layout.tsx) already prints the screen name, so an
          in-page copy of it rendered the same word twice, stacked. The title
          belongs to the header; the body starts with content. */}
      {!embedded && <Stack.Screen options={{ title: 'My Profile' }} />}
      <ScrollView {...fabScroll} contentContainerStyle={{ paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }} showsVerticalScrollIndicator={false}>
        {header}
        {members.map(m => (
          <SelfEditCard key={m.id} member={m} onSave={updateCrewMember} styles={styles} themeColors={themeColors} />
        ))}
        {footer}
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
          <IdBadgeChip member={member} styles={styles} themeColors={themeColors} />
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
          {/* #170: HIRE_ENABLED is off, so no contractor can find anyone yet.
              The switch stays — is_public is exactly what surfacing reads the
              day the flag flips — but it must not read as live. */}
          <Text style={styles.retainHelp}>
            {HIRE_ENABLED
              ? 'Controls whether your profile can appear in the hiring marketplace.'
              : 'Direct Hire isn\u2019t live yet. Turn this on to be listed when it opens.'}
          </Text>
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

/** The ID chip on a roster card and on the worker's own profile (#165):
 *  green "ID Verified", a warning "ID expired <date>" once the ID's own expiry
 *  has passed, or nothing when there is no confirmed scan. */
function IdBadgeChip({
  member, styles, themeColors,
}: {
  member: CrewMember;
  styles: ReturnType<typeof makeStyles>;
  themeColors: ThemeColors;
}) {
  const badge = verifiedBadge(member, todayCalendarDay());
  if (badge === 'id_verified') {
    return (
      <View style={styles.verifiedChip}>
        <ShieldCheck size={12} color={themeColors.accent} strokeWidth={2} />
        <Text style={styles.verifiedChipText}>ID Verified</Text>
      </View>
    );
  }
  if (badge === 'id_expired') {
    return (
      <View style={styles.expiredChip}>
        <AlertTriangle size={12} color={themeColors.warningLabel} strokeWidth={2} />
        <Text style={styles.expiredChipText}>{idExpiredLabel(member.idExpiry)}</Text>
      </View>
    );
  }
  return null;
}

function CrewScreenInner() {
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { crewMembers, addCrewMember, updateCrewMember, deleteCrewMember, getCrewMember, startClaimInvite } = useCrew();
  const { getCertificationsForWorker, certifications } = useSafety();
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

  // Active first, inactive last (#71): an inactive worker stays on the roster
  // (his certs, shifts and claim are kept) but out of the way. Stable sort —
  // newest-first order holds inside each group.
  const sortedMembers = useMemo(
    () => [...crewMembers].sort((a, b) => (a.status === 'inactive' ? 1 : 0) - (b.status === 'inactive' ? 1 : 0)),
    [crewMembers],
  );

  // ── Edit details (#71) ─────────────────────────────────────────────────
  // There was no way to change a worker's name, trades, phone or email once
  // he was added, so "Invite to claim" said "Add an email" with nowhere to
  // add one. The editor is seeded from the member each time it opens, and
  // closes whenever a different member is opened.
  const [editOpen, setEditOpen] = useState(false);
  const [focusEmail, setFocusEmail] = useState(false);
  const [editName, setEditName] = useState('');
  const [editTrades, setEditTrades] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editEmail, setEditEmail] = useState('');
  useEffect(() => { setEditOpen(false); setFocusEmail(false); }, [detailId]);

  // Once he has claimed his profile, phone / email / trades are HIS
  // (SelfEditCard), and the server keeps them from the owner's write
  // (20260923160000). Locked here with the reason, instead of letting the GC
  // type into fields that won't save. The GC's own self-claimed row is not
  // locked — he is that worker.
  const contactLocked = !!member?.claimedByUserId && member.claimedByUserId !== auth.user?.id;

  const openEditor = useCallback((focusOnEmail: boolean) => {
    if (!member) return;
    setEditName(member.fullName);
    setEditTrades(member.trades.join(', '));
    setEditPhone(member.phone ?? '');
    setEditEmail(member.email ?? '');
    setFocusEmail(focusOnEmail);
    setEditOpen(true);
  }, [member]);

  const handleSaveDetails = useCallback(() => {
    if (!member) return;
    const name = editName.trim();
    if (!name) { showAlert('Name required'); return; }
    const mail = editEmail.trim();
    if (!contactLocked && mail && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(mail)) {
      showAlert('Check the email', `"${mail}" isn't a complete email address.`);
      return;
    }
    const changes: Partial<CrewMember> = { fullName: name };
    if (!contactLocked) {
      changes.trades = editTrades.split(',').map(t => t.trim()).filter(Boolean);
      changes.phone = editPhone.trim() || undefined;
      changes.email = mail || undefined;
    }
    updateCrewMember(member.id, changes);
    setEditOpen(false);
    setFocusEmail(false);
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [member, editName, editTrades, editPhone, editEmail, contactLocked, updateCrewMember]);

  const handleSetActive = useCallback((active: boolean) => {
    if (!member) return;
    updateCrewMember(member.id, { status: active ? 'active' : 'inactive' });
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, [member, updateCrewMember]);

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
      // CONTRACT 26 (#124): the server's own sentence, and a cap or a plan
      // gate goes to the plans page — "try again" would be refused again.
      const code = edgeErrorCode(e);
      const message = e instanceof Error && e.message ? e.message : 'Try a clearer, well-lit photo.';
      if (code === 'monthly_cap_reached' || code === 'tier_required') {
        closeScan();
        showAlert(code === 'tier_required' ? 'Not on your plan' : 'Scan limit reached', message, [
          { text: 'Not now', style: 'cancel' },
          { text: 'See plans', onPress: () => router.push('/paywall') },
        ]);
        return;
      }
      showAlert('Scan failed', message);
      setScanStage('capture');
    }
  }, [subscription, closeScan, router]);

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
    // #166: a scan that read no number used to save idVerified:true with an
    // empty mask — the sheet closed on a success haptic and the badge still
    // said "not verified". Save is disabled with the reason on screen; this
    // is the belt to that brace, and the flag can never disagree with it.
    if (!maskedLast4) return;
    const verified = computeIdVerified({ scanCompleted: true, userConfirmed: true }) && !!maskedLast4;
    const target = getCrewMember(scanTargetId);
    const previousImage = target?.idImagePath;
    let idImagePath: string | undefined;
    let imageNotKept = false;
    if (retainImage && Platform.OS !== 'web' && capturedUri && user?.id) {
      // Opt-in retain: uploads to the private worker-ids bucket, returns a PATH.
      idImagePath = (await uploadWorkerIdImage(user.id, scanTargetId, capturedUri)) ?? undefined;
      imageNotKept = !idImagePath;
    }
    // #166: the name he corrected on the review step is written back (it
    // was dropped). A blank field keeps the roster name — full_name is NOT NULL.
    const fullName = scanFields.fullName.trim() || target?.fullName;
    updateCrewMember(scanTargetId, {
      ...(fullName ? { fullName } : {}),
      idVerified: verified,
      idType: scanFields.idType,
      idMaskedLast4: maskedLast4,
      idExpiry: scanFields.expiry || undefined,
      idIssuer: scanFields.issuer || undefined,
      idScannedAt: new Date().toISOString(),
      idImagePath, // undefined on the default purge path — raw image never uploaded
    });
    // A re-scan replaces the ID record (#165). A photo kept from the earlier
    // scan would be left in worker-ids pointing at nothing — delete it. Paths
    // are timestamped, so the new upload is never the old path.
    if (previousImage && previousImage !== idImagePath) void deleteStorageFile('worker-ids', previousImage);
    // Purge the in-memory raw number/image — never persisted.
    setCapturedUri(null); setScanFields(null);
    setScanStage('closed'); setConsentChecked(false); setRetainImage(false); setScanTargetId(null);
    if (imageNotKept) {
      // He chose to keep the photo and it didn't upload. Say so, and no
      // success haptic for a save that didn't do what he asked.
      showAlert(
        'ID photo not kept',
        'It couldn\u2019t upload (no connection?). Only the masked number and expiry were saved. Scan again with signal to keep the photo.',
      );
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    }
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [scanTargetId, scanFields, retainImage, capturedUri, auth, updateCrewMember, getCrewMember]);

  // Remove a wrong or outdated scan without deleting the worker (#165).
  const handleClearId = useCallback(() => {
    if (!member) return;
    showAlert('Remove ID', `Remove the scanned ID from ${member.fullName}? The masked number, expiry and any kept photo are deleted.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          const oldPath = member.idImagePath;
          updateCrewMember(member.id, {
            idVerified: false,
            idType: undefined,
            idMaskedLast4: undefined,
            idExpiry: undefined,
            idIssuer: undefined,
            idImagePath: undefined,
            // A fresh stamp, not a blank one: the server lets the ID fields
            // change only with a NEWER scan time (20260923160000) — that is
            // what stops a stale copy erasing a real scan. The badge reads
            // "not verified" all the same.
            idScannedAt: new Date().toISOString(),
          });
          if (oldPath) void deleteStorageFile('worker-ids', oldPath);
        },
      },
    ]);
  }, [member, updateCrewMember]);

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
    if (!member.email) {
      // #71: the alert used to send him nowhere. 'Add email' opens the
      // editor with the email field focused.
      showAlert('Email needed', `Add ${member.fullName}\u2019s email first \u2014 the claim link is sent there.`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Add email', onPress: () => openEditor(true) },
      ]);
      return;
    }
    try {
      // Async: the token is read back from the server's row, so the link
      // carries the token the server actually stored (CrewContext).
      const token = await startClaimInvite(member.id);
      if (!token) { showAlert('Could not start invite', 'This worker isn\u2019t on your crew list any more.'); return; }
      const { companyName } = await sendClaimInvite(member.email, token, member.id);
      // #72: the invite now goes out in his company's name (read by the
      // server from his own profile) — say which name the worker will see.
      showAlert(
        'Invite sent',
        companyName
          ? `${member.fullName} gets an email from ${companyName} to claim the profile.`
          : `${member.fullName} gets an email from MAGE ID to claim the profile. Your profile has no company name yet, so it says \u201cYour contractor\u201d added them.`,
      );
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      showAlert('Invite failed', e instanceof Error ? e.message : 'Try again.');
    }
  }, [member, startClaimInvite, openEditor]);

  const handleDelete = useCallback(() => {
    if (!member) return;
    // #71: Delete was the only way to take a worker who left off Clock In,
    // and it takes his certificate links and claim with it. Offer the
    // reversible option first.
    const buttons: AlertButton[] = [
      { text: 'Cancel', style: 'cancel' },
    ];
    if (member.status !== 'inactive') {
      buttons.push({ text: 'Mark inactive', onPress: () => handleSetActive(false) });
    }
    buttons.push({
      text: 'Delete',
      style: 'destructive',
      onPress: () => { deleteCrewMember(member.id); setDetailId(null); },
    });
    showAlert(
      'Delete crew member',
      `Remove ${member.fullName} from your roster? Any attached ID is purged, and his certificate links${member.claimedByUserId ? ' and claimed profile' : ''} go with him. To keep his certificates and history, mark him inactive instead.`,
      buttons,
    );
  }, [member, deleteCrewMember, handleSetActive]);

  // A LOCAL calendar day, read at render (#167). The UTC slice named
  // tomorrow from ~8 pm Eastern and called a card expired on its last valid
  // day — and the memo froze it for the screen's lifetime.
  const today = todayCalendarDay();

  return (
    <View style={[styles.container, { backgroundColor: themeColors.bg }]}>
      {/* VIS-19: "Crew" was printed twice — once by the native header this
          route declares in app/_layout.tsx, once by an in-page header row
          directly beneath it, costing ~90pt of the screen to a rendering bug.
          The row existed only to carry the title and the Add button, so the
          title goes back to the header and Add goes with it. */}
      <Stack.Screen
        options={{
          title: 'Crew',
          headerRight: () => (
            <TouchableOpacity
              onPress={() => setAddOpen(true)}
              activeOpacity={0.7}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel="Add crew member"
              testID="add-crew-member"
            >
              <Plus size={22} color={themeColors.accentLabel} strokeWidth={2.25} />
            </TouchableOpacity>
          ),
        }}
      />

      <ScrollView {...fabScroll} contentContainerStyle={{ paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }} showsVerticalScrollIndicator={false}>
        {crewMembers.length === 0 ? (
          <View style={{ minHeight: 420 }}>
            {/* NAV-02 (runtime audit 2026-09-06): certifications and crew are
                different records. An account can hold 16 certifications and 0
                crew members — the founder's does — and anything that sent the
                user here looking for an expiring cert used to strand them on a
                roster that does not contain it. Say where the certs actually
                live, and offer the door. */}
            <EmptyState
              icon={<IdCard size={36} color={themeColors.accent} strokeWidth={1.75} />}
              title="No crew yet"
              message={
                certifications.length > 0
                  ? `Add your first crew member to build a verified roster. Looking for a certification? ${certifications.length} ${certifications.length === 1 ? 'is' : 'are'} on file under Safety — certifications are tracked separately from the roster.`
                  : 'Add your first crew member to build a verified roster.'
              }
              actionLabel="Add crew member"
              onAction={() => setAddOpen(true)}
              secondaryLabel={certifications.length > 0 ? 'Open certifications' : undefined}
              onSecondaryAction={
                certifications.length > 0
                  ? () => router.push('/safety-certifications')
                  : undefined
              }
            />
          </View>
        ) : (
          sortedMembers.map(m => {
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
                    <IdBadgeChip member={m} styles={styles} themeColors={themeColors} />
                    {m.status === 'inactive' ? (
                      <View style={styles.inactiveChip}>
                        <Text style={styles.inactiveChipText}>Inactive</Text>
                      </View>
                    ) : null}
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
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
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
                </View>

                <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 12, gap: 18 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                  {/* Status (#71) — the read-only pill became this switch.
                      Time Tracking and the cert pickers already skip
                      status 'inactive'; nothing ever set it. */}
                  <View style={styles.retainRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.retainLabel}>{member.status === 'inactive' ? 'Inactive' : 'Active'}</Text>
                      <Text style={styles.retainHelp}>
                        Inactive workers drop off Clock In and cert pickers; their shifts and certs stay.
                      </Text>
                    </View>
                    <Switch
                      value={member.status !== 'inactive'}
                      onValueChange={handleSetActive}
                      trackColor={{ true: themeColors.accent, false: themeColors.line }}
                      accessibilityLabel="Active"
                      testID="crew-active-switch"
                    />
                  </View>

                  {/* Details (#71) */}
                  <View style={styles.section}>
                    <Text style={styles.sectionLabel}>Details</Text>
                    {editOpen ? (
                      <>
                        <Text style={styles.fieldLabel}>Full name *</Text>
                        <TextInput style={styles.input} value={editName} onChangeText={setEditName} placeholder="e.g. Maria Gonzalez" placeholderTextColor={themeColors.textMuted} testID="crew-edit-name" />
                        {contactLocked ? (
                          <Text style={styles.lockedNote} testID="crew-contact-locked">
                            He manages his contact details now — he claimed his profile, so his phone, email and trades are his to change.
                          </Text>
                        ) : null}
                        <Text style={styles.fieldLabel}>Trades (comma-separated)</Text>
                        <TextInput style={[styles.input, contactLocked && styles.inputLocked]} value={editTrades} onChangeText={setEditTrades} editable={!contactLocked} placeholder="e.g. Electrical, Framing" placeholderTextColor={themeColors.textMuted} testID="crew-edit-trades" />
                        <Text style={styles.fieldLabel}>Phone</Text>
                        <TextInput style={[styles.input, contactLocked && styles.inputLocked]} value={editPhone} onChangeText={setEditPhone} editable={!contactLocked} placeholder="(555) 123-4567" placeholderTextColor={themeColors.textMuted} keyboardType="phone-pad" testID="crew-edit-phone" />
                        <Text style={styles.fieldLabel}>Email</Text>
                        <TextInput style={[styles.input, contactLocked && styles.inputLocked]} value={editEmail} onChangeText={setEditEmail} editable={!contactLocked} autoFocus={focusEmail && !contactLocked} placeholder="name@email.com" placeholderTextColor={themeColors.textMuted} keyboardType="email-address" autoCapitalize="none" testID="crew-edit-email" />
                        <View style={styles.formActions}>
                          <TouchableOpacity style={styles.cancelBtn} onPress={() => { setEditOpen(false); setFocusEmail(false); }} accessibilityRole="button">
                            <Text style={styles.cancelBtnText}>Cancel</Text>
                          </TouchableOpacity>
                          <TouchableOpacity style={styles.saveBtn} onPress={handleSaveDetails} activeOpacity={0.85} accessibilityRole="button" testID="crew-edit-save">
                            <Text style={styles.saveBtnText}>Save details</Text>
                          </TouchableOpacity>
                        </View>
                      </>
                    ) : (
                      <>
                        <Text style={styles.detailLine}>{member.phone || 'No phone'}</Text>
                        <Text style={styles.detailLine}>{member.email || 'No email'}</Text>
                        <TouchableOpacity style={styles.scanBtn} onPress={() => openEditor(false)} activeOpacity={0.85} accessibilityRole="button" testID="edit-crew-details">
                          <Pencil size={16} color={themeColors.accent} strokeWidth={1.75} />
                          <Text style={styles.scanBtnText}>Edit details</Text>
                        </TouchableOpacity>
                      </>
                    )}
                  </View>

                  {/* Identity (#165: an ID can always be re-scanned, and an
                      expired one says so instead of "ID Verified") */}
                  <View style={styles.section}>
                    <Text style={styles.sectionLabel}>Identity</Text>
                    {(() => {
                      const badge = verifiedBadge(member, today);
                      if (badge === 'id_verified') {
                        return (
                          <View style={styles.identityVerifiedRow}>
                            <ShieldCheck size={16} color={themeColors.accent} strokeWidth={2} />
                            <Text style={styles.identityVerifiedText}>
                              ID Verified — {member.idIssuer ?? 'ID'} ····{member.idMaskedLast4}
                              {member.idExpiry ? `, exp ${member.idExpiry}` : ''}
                            </Text>
                          </View>
                        );
                      }
                      if (badge === 'id_expired') {
                        return (
                          <View style={styles.identityExpiredRow} testID="crew-id-expired">
                            <AlertTriangle size={16} color={themeColors.warningLabel} strokeWidth={2} />
                            <Text style={styles.identityVerifiedText}>
                              {idExpiredLabel(member.idExpiry)} — {member.idIssuer ?? 'ID'} ····{member.idMaskedLast4}. Re-scan his current ID.
                            </Text>
                          </View>
                        );
                      }
                      return <Text style={styles.identityMutedText}>ID not verified</Text>;
                    })()}
                    <TouchableOpacity
                      style={styles.scanBtn}
                      onPress={() => openScan(member.id)}
                      activeOpacity={0.85}
                      testID="scan-id"
                    >
                      <ScanLine size={16} color={themeColors.accent} strokeWidth={1.75} />
                      <Text style={styles.scanBtnText}>{member.idScannedAt || member.idMaskedLast4 ? 'Re-scan ID' : 'Scan ID'}</Text>
                    </TouchableOpacity>
                    {member.idVerified || member.idMaskedLast4 || member.idExpiry || member.idImagePath ? (
                      <Text style={styles.clearIdLink} onPress={handleClearId} accessibilityRole="button" testID="clear-id">
                        Remove ID
                      </Text>
                    ) : null}
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
                        const status = crewCertRowStatus(cert.expiresDate, certExpiryStatus(cert.expiresDate, today));
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
        </KeyboardAvoidingView>
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
                  <CraneSvg size={180} />
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

                  {/* #166: uploadWorkerIdImage never uploads on web, so a
                      switch there promised a photo that was never kept. */}
                  {Platform.OS === 'web' ? (
                    <Text style={styles.retainHelp} testID="scan-retain-web-note">
                      Keeping the photo is iPhone-only. Here we keep only the masked last 4 and expiry; the photo is discarded.
                    </Text>
                  ) : (
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
                  )}

                  {(() => {
                    // #166: no number, no save — the reason on screen.
                    const canSave = !!maskIdLast4(scanFields.idNumberFull);
                    return (
                      <>
                        {!canSave ? (
                          <Text style={styles.scanBlockedText} testID="scan-save-blocked">
                            We couldn’t read an ID number — retake the photo or type the number.
                          </Text>
                        ) : null}
                        <TouchableOpacity
                          style={[styles.saveBtn, !canSave && styles.saveBtnDisabled]}
                          onPress={handleSaveScan}
                          disabled={!canSave}
                          activeOpacity={0.85}
                          accessibilityState={{ disabled: !canSave }}
                          testID="scan-save"
                        >
                          <Text style={styles.saveBtnText}>Save</Text>
                        </TouchableOpacity>
                      </>
                    );
                  })()}
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
// 'check_date' (#167): an expiry that is there but unreadable — never the grey
// "No expiry" a missing date gets.
const CERT_STATUS_LABEL: Record<CrewCertRowStatus, string> = {
  none: 'No expiry',
  valid: 'Valid',
  expiring: 'Expiring soon',
  expired: 'Expired',
  check_date: 'Check date',
};
const CERT_STATUS_STYLE = (t: ThemeColors): Record<CrewCertRowStatus, { color: string }> => ({
  none: { color: t.textSecondary },
  valid: { color: t.success },
  expiring: { color: t.accent },
  expired: { color: t.danger },
  check_date: { color: t.danger },
});

const makeStyles = (themeColors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: themeColors.bg },
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
  expiredChip: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12,
    backgroundColor: themeColors.warningSoft,
  },
  expiredChipText: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const, color: themeColors.warningLabel },
  inactiveChip: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12, backgroundColor: themeColors.neutralSoft },
  inactiveChipText: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const, color: themeColors.textSecondary },

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
  saveBtn: { flex: 2, minHeight: 48, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.accentFill, alignItems: 'center' as const, justifyContent: 'center' as const },
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
  detailLine: { fontSize: Type.subhead.fontSize, color: themeColors.text },
  lockedNote: { fontSize: Type.caption1.fontSize, color: themeColors.textSecondary, lineHeight: 17 },
  inputLocked: { opacity: 0.55 },
  scanBlockedText: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: themeColors.dangerLabel },
  clearIdLink: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: themeColors.dangerLabel, textAlign: 'center' as const, paddingVertical: 6 },
  section: { gap: 8 },
  sectionLabel: { fontSize: 11, fontWeight: '800' as const, color: themeColors.textMuted, letterSpacing: 0.4, textTransform: 'uppercase' as const },
  identityVerifiedRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, backgroundColor: themeColors.accentSoft, borderRadius: Tokens.radius.md, padding: 12 },
  identityExpiredRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, backgroundColor: themeColors.warningSoft, borderRadius: Tokens.radius.md, padding: 12 },
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
  assignChipActive: { backgroundColor: themeColors.accentFill },
  assignChipText: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: themeColors.textSecondary },
  assignChipTextActive: { color: '#FFFFFF' },
  claimedRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, backgroundColor: themeColors.successSoft, borderRadius: Tokens.radius.md, padding: 12 },
  claimedRowText: { flex: 1, fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: themeColors.text },
  inviteBtn: {
    flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 8,
    paddingVertical: 14, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.accentFill,
  },
  inviteBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: '#FFFFFF' },
  deleteBtn: {
    flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 8,
    paddingVertical: 14, borderRadius: Tokens.radius.lg,
    backgroundColor: themeColors.danger + '12', borderWidth: 1, borderColor: themeColors.danger + '20',
  },
  deleteBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: themeColors.danger },
});
