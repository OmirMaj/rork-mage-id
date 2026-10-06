import React, { useState, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Platform, Modal, KeyboardAvoidingView, Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import { useRouter, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Plus, X, Award, Trash2, FileText, User, AlertTriangle, ScanLine, ImagePlus } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import { scanCertification } from '@/utils/crewScan';
import { checkAILimit, recordAIUsage } from '@/utils/aiRateLimiter';
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
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';
import { certStatus } from '@/utils/safety/certStatus';
import type { Certification, CertificationStatus, CrewMember } from '@/types';
import { showAlert } from '@/utils/alert';
import { ensureAiConsent, AI_CONSENT_OFF_MESSAGE, AI_CONSENT_OFF_TITLE } from '@/utils/aiConsent';
import { edgeErrorCode } from '@/utils/edgeError';
import { describeError, rawErrorMessage } from '@/utils/errorCopy';
// Local calendar day for date defaults — toISOString() is the UTC day and
// stamps an after-5pm-Pacific record with tomorrow's date (audit round 2 #6).
import { todayCalendarDay, parseCalendarDay } from '@/utils/calendarDate';
import { useSheetFrame, useSheetPrimaryHotkey } from '@/components/ui';
import { useT } from '@/contexts/LanguageContext';
import { t, tn } from '@/i18n/core';

// Quick-pick common certification types. Free text is still allowed.
// i18n-keep-english: certification names written into the record as its type
const TYPE_QUICKPICKS = ['OSHA 10', 'OSHA 30', 'SST', 'CPR', 'First Aid'];

const STATUS_STYLE = (tc: ThemeColors): Record<CertificationStatus, { label: string; color: string }> => ({
  valid:    { label: t('safety.cert.statusValid', 'Valid'),       color: tc.success },
  expiring: { label: t('safety.cert.statusExpiring', 'Expiring'), color: tc.accent },
  expired:  { label: t('safety.cert.status.expired', 'Expired'),  color: tc.danger },
});

type StatusFilter = 'all' | 'expiring' | 'expired' | 'valid';

export type CertRosterBanner = { text: string; tone: 'clean' | 'attention' };

/**
 * The summary banner's line, or null when there is no verdict to issue.
 *
 * Pure and exported because the screen cannot be rendered with certifications
 * on it: SafetyContext.hydrateCollection reads Supabase whenever `canSync`,
 * the smoke mock answers every select with an empty list, and the hydrate then
 * saves that empty list over any seeded local cache. A render test can only
 * ever observe the zero-record state, so every other branch is pinned here
 * instead (__tests__/smoke/polish-copy-honesty.test.tsx).
 *
 * Two false-green cases are ruled out, both on a screen where the reader is a
 * GC deciding whether his crew can legally be on site tomorrow:
 *
 *  1. ZERO RECORDS. The banner used to be two-state on "is anything expiring",
 *     so an empty roster took the success branch and printed a green "All
 *     certifications are current" directly above "No certifications yet".
 *     Nothing had been checked. With no records there is no verdict, so the
 *     banner does not render and the empty state below speaks instead.
 *  2. RECORDS WITH NO EXPIRY DATE. `expiresDate` is optional on the add form
 *     (only `type` is required) and utils/safety/certStatus.ts returns 'valid'
 *     for a blank one — correctly, "non-expiring" — so a roster of five cards
 *     nobody typed a date on counts zero expiring and would have read "5
 *     certifications on file, none expiring in the next 30 days". MAGE does
 *     not know when those five lapse. Say how many it is actually watching.
 */
export function certRosterBanner(
  total: number,
  expiringOrExpired: number,
  undated: number,
): CertRosterBanner | null {
  if (total <= 0) return null;
  if (expiringOrExpired > 0) {
    return {
      text: tn('safety.cert.bannerAttention', expiringOrExpired, {
        one: '{count} certification expiring soon or expired',
        other: '{count} certifications expiring soon or expired',
      }),
      tone: 'attention',
    };
  }
  const dated = total - undated;
  if (undated > 0) {
    return {
      text: dated === 0
        ? tn('safety.cert.bannerAllUndated', total, {
          one: '{count} certification on file, none with an expiry date. Nothing here for us to watch.',
          other: '{count} certifications on file, none with an expiry date. Nothing here for us to watch.',
        })
        : tn('safety.cert.bannerSomeUndated', undated, {
          one: '{total} certifications on file. None of the {dated} with a date expire in the next 30 days. {count} has no expiry date.',
          other: '{total} certifications on file. None of the {dated} with a date expire in the next 30 days. {count} have no expiry date.',
        }, { total, dated }),
      tone: 'attention',
    };
  }
  // The 30 days is certExpiryStatus's own window (utils/crew/certExpiry.ts),
  // not a number chosen for this sentence.
  return {
    text: tn('safety.cert.bannerClean', total, {
      one: '{count} certification on file, none expiring in the next 30 days',
      other: '{count} certifications on file, none expiring in the next 30 days',
    }),
    tone: 'clean',
  };
}

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
  const { t } = useT();
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { isDesktop } = useResponsiveLayout();
  const { user } = useAuth();
  const router = useRouter();
  const userId = user?.id ?? null;

  const { certifications, certificationsWithStatus, addCertification, updateCertification, deleteCertification } = useSafety();
  const { crewMembers } = useCrew();
  const { subcontractors } = useProjects();

  // Person anchor + sub lookups.
  const memberById = useMemo(() => new Map(crewMembers.map((m) => [m.id, m])), [crewMembers]);
  const subById = useMemo(() => new Map(subcontractors.map((s) => [s.id, s])), [subcontractors]);
  const activeMembers = useMemo(() => crewMembers.filter((m) => m.status === 'active'), [crewMembers]);

  const today = useMemo(() => todayCalendarDay(), []);
  const withStatus = useMemo(() => certificationsWithStatus(today), [certificationsWithStatus, today]);

  const STATUS = useMemo(() => STATUS_STYLE(themeColors), [themeColors]);
  const expiringCount = useMemo(() => withStatus.filter((c) => c.status !== 'valid').length, [withStatus]);
  // Cards with no expiry date on them. certStatus calls those 'valid', so they
  // are invisible to expiringCount — the banner has to count them separately
  // or it claims a 30-day all-clear over records it holds no date for.
  const undatedCount = useMemo(
    () => withStatus.filter((c) => !(c.expiresDate ?? '').trim()).length,
    [withStatus],
  );
  const banner = useMemo(
    () => certRosterBanner(withStatus.length, expiringCount, undatedCount),
    [withStatus.length, expiringCount, undatedCount],
  );

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
  // Card scan (audit round 2 #2). supabase/functions/scan-credential has handled
  // kind 'certification' and utils/crewScan exported scanCertification with no
  // caller, while this form asked the super to type both dates off a card
  // nobody photographed. `scanNote` says the fields were read by AI.
  const { tier } = useTierAccess();
  const [scanning, setScanning] = useState(false);
  const [scanNote, setScanNote] = useState<string | null>(null);

  const resetForm = useCallback(() => {
    setEditing(null);
    setWorkerId(undefined);
    setHolderName('');
    setType('');
    setSubId('');
    setIssuedDate('');
    setExpiresDate('');
    setDocumentUrl('');
    setScanNote(null); setScanning(false);
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

  const handleScanCard = useCallback(async (source: 'camera' | 'library') => {
    const perm = source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      showAlert(source === 'camera' ? t('safety.cert.cameraAccessNeeded', 'Camera Access Needed') : t('safety.cert.photoAccessNeeded', 'Photo Access Needed'),
        source === 'camera'
          ? t('safety.cert.grantCamera', 'Grant camera access in Settings to scan a card.')
          : t('safety.cert.grantPhoto', 'Grant photo access in Settings to scan a card.'));
      return;
    }
    // Same metering key as the crew ID scan: both call scan-credential, and the
    // server's monthly cap is the authoritative one.
    const limit = await checkAILimit(tier, 'smart', 'scanCredential');
    if (!limit.allowed) { showAlert(t('safety.cert.scanLimitReached', 'Scan Limit Reached'), limit.message ?? t('safety.cert.scanLimitReachedSee', 'Scan limit reached. See plans for more card scans.')); return; }
    // App Store 5.1.2(i): nothing leaves for the AI provider until the person
    // has allowed AI features (utils/aiConsent; always allowed on the web app).
    if (!(await ensureAiConsent())) { showAlert(AI_CONSENT_OFF_TITLE, AI_CONSENT_OFF_MESSAGE); return; }
    const result = source === 'camera'
      ? await ImagePicker.launchCameraAsync({ quality: 0.5, base64: true })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.5, base64: true });
    if (result.canceled || !result.assets?.[0]?.base64) return;
    setScanning(true);
    setScanNote(null);
    try {
      const fields = await scanCertification(result.assets[0].base64);
      await recordAIUsage('smart', 'scanCredential');
      // Only a real calendar day is written into a date field; anything else the
      // model returned is left blank for him to type rather than stored as a
      // date certStatus would then flag 'expired'.
      const day = (v: string | undefined) => {
        const ymd = (v ?? '').trim().slice(0, 10);
        return /^\d{4}-\d{2}-\d{2}$/.test(ymd) && parseCalendarDay(ymd) ? ymd : '';
      };
      if (fields.certType?.trim()) setType(fields.certType.trim());
      const iss = day(fields.issuedDate);
      const exp = day(fields.expiresDate);
      if (iss) setIssuedDate(iss);
      if (exp) setExpiresDate(exp);
      // The AI honesty line is catalog text (docs/I18N.md §7.4), never model
      // output: one whole sentence per case, then the second sentence.
      const issuer = fields.issuer ?? '';
      const number = fields.certNumber ?? '';
      const readLine = issuer && number
        ? t('safety.cert.readByAiIssuerNumber', 'Read from the card by AI (issuer: {issuer}), card no. {number}.', { issuer, number })
        : issuer
          ? t('safety.cert.readByAiIssuer', 'Read from the card by AI (issuer: {issuer}).', { issuer })
          : number
            ? t('safety.cert.readByAiNumber', 'Read from the card by AI, card no. {number}.', { number })
            : t('safety.cert.readByAi', 'Read from the card by AI.');
      setScanNote(
        `${readLine} `
        + (exp ? t('safety.cert.checkDates', 'Check the dates against the card before saving.') : t('safety.cert.noExpiryRead', 'No expiry date could be read. Type it from the card.')),
      );
    } catch (e) {
      // CONTRACT 26 (#124): scanCertification throws edgeFunctionError, so a
      // plan refusal carries the server's code and sentence. That is not a
      // "try a clearer photo" failure — say it, and offer the plans, no retry.
      const code = edgeErrorCode(e);
      if (code === 'monthly_cap_reached' || code === 'tier_required') {
        const msg = e instanceof Error ? e.message : '';
        setScanNote(msg || t('safety.cert.cardScanningIsntAvailable', "Card scanning isn't available on your plan right now."));
        showAlert(
          code === 'tier_required' ? t('safety.cert.notIncludedInYour', 'Not Included in Your Plan') : t('safety.cert.youveHitThisMonths', "You've hit this month's limit"),
          msg || t('safety.cert.cardScanningIsntAvailable', "Card scanning isn't available on your plan right now."),
          [
            { text: t('safety.cert.notNow', 'Not Now'), style: 'cancel' },
            { text: t('safety.cert.seePlans', 'See Plans'), onPress: () => router.push('/paywall' as never) },
          ],
        );
      } else if (code === 'hourly_limit') {
        setScanNote(e instanceof Error && e.message ? e.message : t('safety.cert.scanHourly', 'Scan limit reached for this hour. Try again later.'));
      } else {
        console.warn('[safety-certifications] scan failed', rawErrorMessage(e));
        setScanNote(`${describeError(e, { action: 'read the card' }).body} ${t('safety.cert.clearerPhoto', 'A clearer, well-lit photo helps.')}`);
      }
    } finally {
      setScanning(false);
    }
  }, [tier, router, t]);

  const pickMember = useCallback((member: CrewMember) => {
    setWorkerId(member.id);
    setHolderName(member.fullName);
  }, []);
  const clearMember = useCallback(() => setWorkerId(undefined), []);

  const handleSave = useCallback(() => {
    const holder = holderName.trim();
    if (!workerId && !holder) { showAlert(t('safety.cert.addAHolder', 'Add a Holder'), t('safety.cert.pickACrewMember', 'Pick a crew member or enter a holder name.')); return; }
    if (!type.trim()) { showAlert(t('safety.cert.addACertificationType', 'Add a Certification Type'), t('safety.cert.enterTheCertificationType', 'Enter the certification type.')); return; }
    // Reject an unparseable date rather than silently storing it (certStatus would
    // otherwise flag it 'expired'; catch the typo at entry so the user can fix it).
    const expTrim = expiresDate.trim();
    if (expTrim && Number.isNaN(Date.parse(expTrim))) {
      showAlert(t('safety.cert.checkTheExpiryDate', 'Check the Expiry Date'), t('safety.cert.enterTheExpiryAs', 'Enter the expiry as YYYY-MM-DD, for example 2026-12-31.'));
      return;
    }
    const issTrim = issuedDate.trim();
    if (issTrim && Number.isNaN(Date.parse(issTrim))) {
      showAlert(t('safety.cert.checkTheIssuedDate', 'Check the Issued Date'), t('safety.cert.enterTheIssuedDate', 'Enter the issued date as YYYY-MM-DD, for example 2025-01-15.'));
      return;
    }
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
  }, [workerId, holderName, type, subId, issuedDate, expiresDate, documentUrl, today, editing, userId, addCertification, updateCertification, resetForm, t]);

  const handleDelete = useCallback((cert: Certification) => {
    showAlert(t('safety.cert.deleteCertification', 'Delete Certification'), t('safety.cert.deleteConfirm', 'Delete "{type}" for {name}?', { type: cert.type, name: displayName(cert) }), [
      { text: t('common.action.cancel', 'Cancel'), style: 'cancel' },
      { text: t('common.action.delete', 'Delete'), style: 'destructive', onPress: () => deleteCertification(cert.id) },
    ]);
  }, [deleteCertification, displayName, t]);

  const openDocument = useCallback((url: string) => {
    void Linking.openURL(url).catch(() => showAlert(t('safety.cert.couldntOpenTheDocument', "Couldn't Open the Document"), t('safety.cert.thisDocumentLinkCouldnt', "This document link couldn't be opened.")));
  }, [t]);

  const filterChips: { key: StatusFilter; label: string }[] = [
    { key: 'all', label: t('safety.cert.filterAll', 'All') },
    { key: 'expiring', label: t('safety.cert.statusExpiring', 'Expiring') },
    { key: 'expired', label: t('safety.cert.status.expired', 'Expired') },
    { key: 'valid', label: t('safety.cert.statusValid', 'Valid') },
  ];

  // Desktop sheet (wave 6c): the form opens as a capped card centred in the
  // content column; Cmd/Ctrl+Enter or Cmd/Ctrl+S saves it.
  const fForm = useSheetFrame('form', { visible: showForm, animationType: 'slide' });
  useSheetPrimaryHotkey(showForm, handleSave);

  return (
    <View style={[styles.container, { backgroundColor: themeColors.bg }]}>
      <Stack.Screen options={{ title: t('safety.cert.certifications', 'Certifications') }} />
      <ScrollView {...fabScroll} contentContainerStyle={[{ paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }, isDesktop && styles.contentDesktop]} showsVerticalScrollIndicator={false}>
        {/* Expiring-soon summary banner. Every branch, and the decision not to
            render one at all, lives in certRosterBanner above — the header
            comment there says which false green each branch exists to prevent.
            Green is reserved for the one state that earned it. */}
        {banner && (
          <View style={[styles.banner, banner.tone === 'attention' ? { backgroundColor: themeColors.accent + '14', borderColor: themeColors.accent + '26' } : { backgroundColor: themeColors.success + '12', borderColor: themeColors.success + '22' }]}>
            <AlertTriangle size={18} color={banner.tone === 'attention' ? themeColors.accent : themeColors.success} strokeWidth={1.75} />
            <Text style={styles.bannerText}>{banner.text}</Text>
          </View>
        )}

        {/* Status filter chips */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
          {filterChips.map((chip) => {
            const active = filter === chip.key;
            return (
              <TouchableOpacity
                key={chip.key}
                style={[styles.filterChip, active && { backgroundColor: themeColors.accentFill }]}
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
                        <Text style={styles.crewTagText}>{t('safety.cert.crew', 'Crew')}</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.cardType}>{cert.type}</Text>
                </View>
                <View style={[styles.statusBadge, { backgroundColor: s.color + '18' }]}>
                  <Text style={[styles.statusBadgeText, { color: s.color }]}>{s.label}</Text>
                </View>
              </View>

              <Text style={styles.cardMeta}>{cert.expiresDate ? t('safety.cert.expires', 'Expires {expiresDate}', { expiresDate: cert.expiresDate }) : t('safety.cert.noExpiry', 'No Expiry')}</Text>

              <View style={styles.chipRow}>
                {sub ? <Text style={styles.subName}>{t('safety.cert.sub', 'Sub: {companyName}', { companyName: sub.companyName })}</Text> : null}
                {cert.documentUrl ? (
                  <TouchableOpacity
                    style={styles.docChip}
                    onPress={() => openDocument(cert.documentUrl!)}
                    accessibilityRole="button"
                    accessibilityLabel={t('safety.cert.viewDocument', 'View Document')}
                  >
                    <FileText size={11} color={themeColors.accent} strokeWidth={1.75} />
                    <Text style={styles.docChipText}>{t('safety.cert.viewDocument', 'View Document')}</Text>
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
              title={certifications.length === 0 ? t('safety.cert.noCertificationsYet', 'No Certifications Yet') : t('safety.cert.nothingMatchesThatFilter', 'Nothing Matches That Filter')}
              message={certifications.length === 0
                ? t('safety.cert.trackOshaCardsCpr', 'Track OSHA cards, CPR, First Aid, SST, and trade licenses for your crew and subs. Link each cert to a crew member so it also shows on their profile, and get a heads-up before anything lapses.')
                : t('safety.cert.noCertificationsCurrentlySit', 'No certifications currently sit in "{filter}". Switch filters above to see the rest.', { filter })}
              actionLabel={certifications.length === 0 ? t('safety.cert.addFirstCertification', 'Add First Certification') : undefined}
              onAction={certifications.length === 0 ? openNew : undefined}
            />
          </View>
        )}

        <TouchableOpacity style={styles.addItemBtn} onPress={openNew} activeOpacity={0.7} testID="add-certification">
          <Plus size={16} color={themeColors.accent} strokeWidth={1.75} />
          <Text style={styles.addItemBtnText}>{t('safety.cert.addCertification', 'Add Certification')}</Text>
        </TouchableOpacity>
      </ScrollView>

      <Modal visible={showForm} transparent animationType={fForm.animationType} onRequestClose={() => { setShowForm(false); resetForm(); }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalOverlay}>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={[{ flexGrow: 1, justifyContent: 'flex-end' as const }, fForm.scrollContent]} keyboardShouldPersistTaps="handled">
              <View style={[styles.formCard, { paddingBottom: insets.bottom + 20, maxHeight: '92%' }, fForm.card]}>
                <View style={styles.formHeader}>
                  <Text style={styles.formTitle}>{editing ? t('safety.cert.editCertification', 'Edit Certification') : t('safety.cert.newCertification', 'New Certification')}</Text>
                  <TouchableOpacity onPress={() => { setShowForm(false); resetForm(); }} accessibilityRole="button" accessibilityLabel={t('common.action.close', 'Close')}>
                    <X size={20} color={themeColors.textMuted} strokeWidth={1.75} />
                  </TouchableOpacity>
                </View>

                <ScrollView style={{ maxHeight: 540 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                  {/* Crew-member picker first — pick a person to anchor the cert. */}
                  <Text style={styles.fieldLabel}>{t('safety.cert.crewMember', 'Crew Member')}</Text>
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
                    <Text style={styles.hintText}>{t('safety.cert.noActiveCrewMembers', 'No active crew members yet. Enter a holder name below.')}</Text>
                  )}
                  {workerId ? (
                    <TouchableOpacity style={styles.clearMemberBtn} onPress={clearMember} accessibilityRole="button" accessibilityLabel={t('safety.cert.unlinkCrewMember', 'Unlink Crew Member')}>
                      <X size={12} color={themeColors.textSecondary} strokeWidth={1.75} />
                      <Text style={styles.clearMemberText}>{t('safety.cert.notOnTheCrew', 'Not on the crew? Enter the name by hand')}</Text>
                    </TouchableOpacity>
                  ) : null}

                  <Text style={styles.fieldLabel}>{t('safety.cert.holderName', 'Holder Name')}{workerId ? '' : ' *'}</Text>
                  <TextInput
                    style={[styles.input, workerId ? { opacity: 0.6 } : null]}
                    value={holderName}
                    onChangeText={setHolderName}
                    placeholder={t('safety.cert.fullName', 'Full name')}
                    placeholderTextColor={themeColors.textMuted}
                    editable={!workerId}
                  />

                  <View style={styles.scanRow}>
                    <TouchableOpacity style={styles.scanBtn} onPress={() => void handleScanCard('camera')} disabled={scanning} accessibilityRole="button" testID="cert-scan-camera">
                      <ScanLine size={15} color={themeColors.accentLabel} strokeWidth={1.75} />
                      <Text style={styles.scanBtnText}>{scanning ? t('safety.cert.readingCard', 'Reading card…') : t('safety.cert.scanCard', 'Scan Card')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.scanBtn} onPress={() => void handleScanCard('library')} disabled={scanning} accessibilityRole="button" testID="cert-scan-library">
                      <ImagePlus size={15} color={themeColors.accentLabel} strokeWidth={1.75} />
                      <Text style={styles.scanBtnText}>{t('safety.cert.fromPhotos', 'From Photos')}</Text>
                    </TouchableOpacity>
                  </View>
                  {scanNote ? <Text style={styles.hintText} testID="cert-scan-note">{scanNote}</Text> : null}

                  <Text style={styles.fieldLabel}>{t('safety.cert.certificationType', 'Certification Type *')}</Text>
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
                  <TextInput style={styles.input} value={type} onChangeText={setType} placeholder={t('safety.cert.eGOsha30', 'OSHA 30, Journeyman license')} placeholderTextColor={themeColors.textMuted} testID="cert-type-input" />

                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.fieldLabel}>{t('safety.cert.issuedDate', 'Issued Date')}</Text>
                      <TextInput style={styles.input} value={issuedDate} onChangeText={setIssuedDate} placeholder={t('safety.dateHint', 'YYYY-MM-DD')} placeholderTextColor={themeColors.textMuted} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.fieldLabel}>{t('safety.cert.expiryDate', 'Expiry Date')}</Text>
                      <TextInput style={styles.input} value={expiresDate} onChangeText={setExpiresDate} placeholder={t('safety.dateHint', 'YYYY-MM-DD')} placeholderTextColor={themeColors.textMuted} />
                    </View>
                  </View>

                  {subcontractors.length > 0 && (
                    <>
                      <Text style={styles.fieldLabel}>{t('safety.cert.subOptional', 'Sub (Optional)')}</Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 2 }}>
                        <TouchableOpacity
                          style={[styles.typeChip, !subId && styles.typeChipActive]}
                          onPress={() => setSubId('')}
                        >
                          <Text style={[styles.typeChipText, !subId && styles.typeChipTextActive]}>{t('safety.cert.none', 'None')}</Text>
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

                  <Text style={styles.fieldLabel}>{t('safety.cert.documentUrlOptional', 'Document URL (Optional)')}</Text>
                  <TextInput style={styles.input} value={documentUrl} onChangeText={setDocumentUrl} placeholder="https://" placeholderTextColor={themeColors.textMuted} autoCapitalize="none" keyboardType="url" />
                </ScrollView>

                <View style={styles.formActions}>
                  {editing && (
                    <TouchableOpacity style={styles.deleteBtn} onPress={() => { setShowForm(false); handleDelete(editing); }}>
                      <Trash2 size={16} color={themeColors.danger} strokeWidth={1.75} />
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity style={styles.cancelBtn} onPress={() => { setShowForm(false); resetForm(); }}>
                    <Text style={styles.cancelBtnText}>{t('common.action.cancel', 'Cancel')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.saveBtn} onPress={handleSave} activeOpacity={0.85} testID="save-certification">
                    <Text style={styles.saveBtnText}>{editing ? t('safety.cert.update', 'Update') : t('common.action.save', 'Save')}</Text>
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
  // Record lists (certs / incidents / inspections / forms) — desktop gets the
  // viewport rather than a 760px column stranded in the middle.
  contentDesktop: { width: '100%', maxWidth: 1200, alignSelf: 'center' as const },
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
  scanRow: { flexDirection: 'row' as const, gap: 8, marginTop: 12 },
  scanBtn: { flex: 1, flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 6, minHeight: 44, borderRadius: Tokens.radius.card, backgroundColor: themeColors.accentSoft },
  scanBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: themeColors.accentLabel },
  hintText: { fontSize: Type.caption1.fontSize, color: themeColors.textMuted, marginTop: 4 },
  input: { minHeight: 44, borderRadius: Tokens.radius.card, backgroundColor: themeColors.surfaceAlt, paddingHorizontal: 14, fontSize: Type.subhead.fontSize, color: themeColors.text, marginTop: 4 },
  memberChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: Tokens.radius.md, backgroundColor: themeColors.line },
  memberChipActive: { backgroundColor: themeColors.accentFill },
  memberChipText: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: themeColors.textSecondary },
  memberChipTextActive: { color: '#fff' },
  clearMemberBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6, alignSelf: 'flex-start' as const, marginTop: 8, paddingHorizontal: 10, paddingVertical: 6, borderRadius: Tokens.radius.sm, backgroundColor: themeColors.line },
  clearMemberText: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: themeColors.textSecondary },
  typeChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: Tokens.radius.md, backgroundColor: themeColors.line },
  typeChipActive: { backgroundColor: themeColors.accentFill },
  typeChipText: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: themeColors.textSecondary },
  typeChipTextActive: { color: '#fff' },
  formActions: { flexDirection: 'row' as const, gap: 10, marginTop: 12 },
  deleteBtn: { width: 48, minHeight: 48, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.danger + '14', alignItems: 'center' as const, justifyContent: 'center' as const },
  cancelBtn: { flex: 1, minHeight: 48, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.line, alignItems: 'center' as const, justifyContent: 'center' as const },
  cancelBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: themeColors.text },
  saveBtn: { flex: 2, minHeight: 48, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.accentFill, alignItems: 'center' as const, justifyContent: 'center' as const },
  saveBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: '#fff' },
});
