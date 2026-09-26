// COI Vault — per-subcontractor Certificate of Insurance management.
//
// One screen, two modes:
//   - List mode: shows all subs with their COI status (valid / expiring /
//     expired / missing endorsement). Tap a sub to drill in.
//   - Detail mode: per-sub list of certificates, their findings, the coverage
//     rows (type, policy #, carrier, effective + expiry day), and an upload
//     button that takes a photo or a PDF.
//
// AUDIT #23 / #40 / #26 / #66 (wave 5):
//   • The AI read (analyze-photos task 'coi') only works once that build is
//     deployed; until then the card says reading isn't live. Either way every
//     card has MANUAL COVERAGE ROWS — the path that always works — saved
//     through updateCOI, so ProjectContext.syncSubCoiExpiry moves
//     subcontractors.coi_expiry and coi-expiry-watch can remind the GC. Dates
//     the model read show as unconfirmed until he confirms them.
//   • The file is uploaded to the private sub-documents bucket and fileUri
//     holds 'sub-documents:<subId>/coi-<coiId>.<ext>' (CONTRACT 7) — never the
//     picker's file:// or blob: URI, which is blank on every other device and
//     on this one once iOS clears its cache. It is shown through a one-hour
//     signed URL (utils/coiFiles.resolveCoiFileUrl); a PDF is an "Open
//     certificate" row. A file picked offline stays in a device-only pending
//     map, previewed as "Not uploaded yet — only on this phone", and is
//     uploaded on the next open.
//   • The list's expiry falls back to the COI Expiry typed on the sub's record
//     when the latest certificate has no coverage date, and says so.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Platform, ActivityIndicator, Image, Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as WebBrowser from 'expo-web-browser';
import {
  ChevronLeft, Shield, ShieldCheck, ShieldAlert, ShieldX, Plus,
  Upload, Trash2, AlertTriangle, CheckCircle2, FileText, Calendar,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { cardSurface } from '@/components/ui';
import type { ThemeColors } from '@/constants/colors';
import { neutralInk } from '@/components/ui/ink';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useProjects } from '@/contexts/ProjectContext';
import { useAuth } from '@/contexts/AuthContext';
import { useTierAccess } from '@/hooks/useTierAccess';
import { FeatureHeader } from '@/components/FeatureHeader';
import { MageCOI } from '@/components/icons';
import Paywall from '@/components/Paywall';
import DatePickerModal from '@/components/DatePickerModal';
import { supabase } from '@/lib/supabase';
import { generateUUID } from '@/utils/generateId';
import { readFileBytes } from '@/utils/fileBytes';
import { formatCalendarDay } from '@/utils/calendarDate';
import { validateCOIImage, recomputeValidation } from '@/utils/coiValidator';
import {
  resolveCoiFileUrl, coiFileLocation, coiFileType, coiStoragePath, subDocumentsFileUri, isPdfCoiFile,
  hasUnconfirmedAi, confirmAiCoverage, pickCoverageDate,
  SUB_DOCUMENTS_BUCKET, COI_PENDING_UPLOADS_KEY,
  type PendingCoiUpload,
} from '@/utils/coiFiles';
import { vaultCoiExpiry, vaultCoiStatus, type VaultCoiStatus } from '@/utils/subCompliance';
import type { CertificateOfInsurance, COICoverage, COICoverageType, Subcontractor } from '@/types';
import { Type } from '@/constants/typography';
import { Layout, Tokens } from '@/constants/designTokens';
import { showAlert } from '@/utils/alert';
import { useIsDesktopWeb } from '@/components/ui/desktop';
import { ChipRail } from '@/components/ui';
import { useSplitRecord } from '@/components/desktop/SplitView';
import { CoiVaultRegister } from '@/components/registers/CoiVaultRegister';
import { useRegisterRecordDirty } from '@/components/registers/RegisterRecordHost';

export default function COIVaultScreen() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { canAccess, requiredTierFor } = useTierAccess();
  if (!canAccess('rfis_submittals')) {
    return (
      <Paywall
        visible={true}
        // Not the old "COI Vault & Insurance V." key: its pitch sells
        // certificates "checked for the limits you require", which nothing
        // here does (#40 sharpening). This key's pitch — certificates per
        // sub with expiry dates that surface before they lapse — is what the
        // vault does. components/Paywall.tsx is the paywall lane's; the
        // orphaned key's removal is handed to w5-join-screens.
        feature="Prequal + COI Tracking"
        // Derived, never typed. These four screens all said "business" while
        // their gate said 'rfis_submittals' — true until that key moved to
        // Pro, at which point the paywall quoted a price the gate did not
        // charge. requiredTierFor reads featureTiers.ts, so the number on the
        // wall is the number on the door.
        requiredTier={requiredTierFor('rfis_submittals')}
        onClose={() => router.back()}
      />
    );
  }
  return <COIVaultInner />;
}

type PendingMap = Record<string, PendingCoiUpload>;

async function readPending(): Promise<PendingMap> {
  try {
    const raw = await AsyncStorage.getItem(COI_PENDING_UPLOADS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as PendingMap : {};
  } catch {
    return {};
  }
}

async function writePending(map: PendingMap): Promise<void> {
  try { await AsyncStorage.setItem(COI_PENDING_UPLOADS_KEY, JSON.stringify(map)); } catch { /* preview only */ }
}

/** Upload a picked COI file to sub-documents. Returns the CONTRACT 7 fileUri. */
async function uploadCoiFile(entry: Pick<PendingCoiUpload, 'localUri' | 'subId' | 'coiId' | 'ext' | 'contentType'>): Promise<string> {
  const bytes = await readFileBytes(entry.localUri);
  if (bytes.byteLength === 0) throw new Error('The picked file is empty.');
  const path = coiStoragePath(entry.subId, entry.coiId, entry.ext);
  const { error } = await supabase.storage
    .from(SUB_DOCUMENTS_BUCKET)
    .upload(path, bytes, { contentType: entry.contentType, upsert: true });
  if (error) throw error;
  return subDocumentsFileUri(path);
}

/** A read of the local file failing means the file itself is gone (iOS purged
 *  the picker cache, or the browser released a blob:) — no retry brings it back. */
function isFileGone(err: unknown): boolean {
  const m = String((err as { message?: unknown })?.message ?? err ?? '');
  return /empty|no such file|could not be read|isn't readable|not exist|source expired|ENOENT/i.test(m);
}

function COIVaultInner() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const { subId: initialSubId } = useLocalSearchParams<{ subId?: string }>();
  const ctx = useProjects() as any;
  // The context's add/update close over the list of the render that made
  // them. The old upload flow called the captured updateCOI after an awaited
  // AI read, writing from a list WITHOUT the new certificate — which dropped
  // it from the screen. Writes go through the latest ctx instead, and patches
  // for a new certificate wait until it is in the list (below).
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const { user } = useAuth();
  const userId: string | null = user?.id ?? null;
  const subcontractors: Subcontractor[] = ctx.subcontractors ?? [];
  const cois: CertificateOfInsurance[] = ctx.cois ?? [];

  const [activeSubId, setActiveSubId] = useState<string | null>(initialSubId ?? null);
  // Desktop web (wave 6d, R2): the register — a table with the open sub's
  // certificates beside it. ?subId= is today's deep-link param, so a pasted
  // /coi-vault?subId=X opens X beside the list. A phone, a native tablet and a
  // narrow browser keep today's list and full-screen detail (activeSubId).
  const isDesktopWeb = useIsDesktopWeb();
  const split = useSplitRecord({ param: 'subId' });
  const [busy, setBusy] = useState<null | 'uploading' | 'reading'>(null);
  const [pending, setPending] = useState<PendingMap>({});
  const [pendingLoaded, setPendingLoaded] = useState(false);

  const activeSub = useMemo(() => subcontractors.find(s => s.id === (isDesktopWeb ? split.openId : activeSubId)), [isDesktopWeb, split.openId, activeSubId, subcontractors]);
  const subCOIs = useMemo(() => cois.filter(c => c.subcontractorId === activeSub?.id), [cois, activeSub?.id]);

  // ── Patches that wait for their certificate ─────────────────
  // One updateCOI per render: two in the same tick would both start from the
  // same list and the second would undo the first.
  const patchesRef = useRef(new Map<string, Partial<CertificateOfInsurance>>());
  const [patchTick, setPatchTick] = useState(0);
  const queuePatch = useCallback((id: string, patch: Partial<CertificateOfInsurance>) => {
    patchesRef.current.set(id, { ...(patchesRef.current.get(id) ?? {}), ...patch });
    setPatchTick(t => t + 1);
  }, []);
  useEffect(() => {
    for (const [id, patch] of patchesRef.current) {
      if (!cois.some(c => c.id === id)) continue;
      patchesRef.current.delete(id);
      ctxRef.current.updateCOI?.(id, patch);
      return; // the list changes → this runs again for the next one
    }
  }, [cois, patchTick]);

  // ── Pending uploads (device-only) ──────────────────────────
  const updatePending = useCallback((fn: (m: PendingMap) => PendingMap) => {
    setPending(prev => {
      const next = fn(prev);
      if (next !== prev) void writePending(next);
      return next;
    });
  }, []);
  useEffect(() => {
    let alive = true;
    void readPending().then(m => { if (alive) { setPending(m); setPendingLoaded(true); } });
    return () => { alive = false; };
  }, []);

  // Retry each waiting upload once per open, for certificates that are in the
  // list and still have no stored file. Another account's entries are ignored.
  const retried = useRef(new Set<string>());
  useEffect(() => {
    if (!pendingLoaded || !userId) return;
    for (const entry of Object.values(pending)) {
      if (entry.userId !== userId || retried.current.has(entry.coiId)) continue;
      const coi = cois.find(c => c.id === entry.coiId);
      if (!coi) continue;
      retried.current.add(entry.coiId);
      if (coi.fileUri && coiFileLocation(coi.fileUri) !== 'device') {
        updatePending(m => { const n = { ...m }; delete n[entry.coiId]; return n; });
        continue;
      }
      if (entry.lost) continue;
      void uploadCoiFile(entry).then(
        fileUri => {
          queuePatch(entry.coiId, { fileUri });
          updatePending(m => { const n = { ...m }; delete n[entry.coiId]; return n; });
        },
        err => {
          if (isFileGone(err)) updatePending(m => ({ ...m, [entry.coiId]: { ...entry, lost: true } }));
        },
      );
    }
  }, [pendingLoaded, pending, cois, userId, queuePatch, updatePending]);

  // Compliance summary across all subs — drives the top-of-list banner.
  // Three tiers of urgency: expired (action required NOW), expiring within
  // 30 days (action this month), missing entirely (no certificate uploaded).
  // The expiry is the latest certificate's earliest coverage date, else the
  // COI Expiry typed on the sub's record — a certificate with no dates no
  // longer drops the sub out of the count (audit #40).
  const complianceSummary = useMemo(() => {
    const now = new Date();
    let expired = 0;
    let expiringSoon = 0;
    let missing = 0;
    for (const sub of subcontractors) {
      const subC = cois.filter(c => c.subcontractorId === sub.id);
      if (subC.length === 0) {
        missing += 1;
        continue;
      }
      const latest = [...subC].sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime())[0];
      const st = vaultCoiStatus(vaultCoiExpiry(latest, sub), now);
      if (st.key === 'expired') expired += 1;
      else if (st.key === 'expiring') expiringSoon += 1;
    }
    return { expired, expiringSoon, missing };
  }, [subcontractors, cois]);

  // ── Status rollup per sub for the list view ─────────────────
  const subStatus = useMemo(() => {
    const m = new Map<string, { worst: 'pass' | 'warn' | 'fail' | 'none'; latest?: CertificateOfInsurance }>();
    for (const sub of subcontractors) {
      const subC = cois.filter(c => c.subcontractorId === sub.id);
      if (subC.length === 0) {
        m.set(sub.id, { worst: 'none' });
        continue;
      }
      // Pick the most recent COI as the "current" one for the row
      const latest = subC.slice().sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime())[0];
      const v = latest.validation;
      m.set(sub.id, { worst: v ? v.overallStatus : 'warn', latest });
    }
    return m;
  }, [subcontractors, cois]);

  // ── Upload (photo or PDF) + read ────────────────────────────
  const ingest = useCallback(async (picked: { uri: string; name?: string | null; mimeType?: string | null }) => {
    const sub = activeSub;
    if (!sub) return;
    const coiId = generateUUID();
    const { ext, contentType } = coiFileType(picked);
    const entry: PendingCoiUpload = {
      coiId, subId: sub.id, localUri: picked.uri, ext, contentType,
      userId: userId ?? '', pickedAt: new Date().toISOString(),
    };
    setBusy('uploading');
    let fileUri = '';
    try {
      fileUri = await uploadCoiFile(entry);
    } catch (err) {
      if (isFileGone(err)) {
        setBusy(null);
        showAlert("Couldn't read that file", 'Pick the certificate again.');
        return;
      }
      // Offline or refused: keep the local file as a labelled preview on this
      // phone only and retry on the next open. Never written to the row.
      updatePending(m => ({ ...m, [coiId]: entry }));
    }
    const newCoi: CertificateOfInsurance = {
      id: coiId,
      subcontractorId: sub.id,
      fileUri,
      uploadedAt: new Date().toISOString(),
    };
    ctxRef.current.addCOI?.(newCoi);
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    setBusy('reading');
    try {
      // Never throws: a read that doesn't happen comes back as a finding that
      // says why, and the card opens an empty coverage row.
      const { coverages, validation } = await validateCOIImage(picked.uri, contentType);
      queuePatch(coiId, { coverages, validation });
    } finally {
      setBusy(null);
    }
  }, [activeSub, userId, updatePending, queuePatch]);

  const pickFrom = useCallback(async (source: 'photos' | 'files') => {
    try {
      if (source === 'photos') {
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          allowsEditing: false,
          quality: 0.85,
        });
        if (result.canceled || !result.assets[0]) return;
        const a = result.assets[0];
        await ingest({ uri: a.uri, name: a.fileName ?? null, mimeType: a.mimeType ?? null });
      } else {
        // Carriers email COIs as PDFs; the photo picker could never take one.
        const picked = await DocumentPicker.getDocumentAsync({
          type: ['application/pdf', 'image/*'],
          copyToCacheDirectory: true,
          multiple: false,
        });
        if (picked.canceled || !picked.assets?.[0]) return;
        const a = picked.assets[0];
        await ingest({ uri: a.uri, name: a.name, mimeType: a.mimeType ?? null });
      }
    } catch (err) {
      setBusy(null);
      console.error('[COI] Upload failed:', err);
      showAlert('Upload failed', err instanceof Error ? err.message : 'Try again.');
    }
  }, [ingest]);

  const handleUpload = useCallback(() => {
    if (!activeSub) return;
    // The web picker takes both kinds in one dialog.
    if (Platform.OS === 'web') { void pickFrom('files'); return; }
    showAlert('Add a certificate', 'A photo of the certificate, or the PDF the carrier sent?', [
      { text: 'Photo', onPress: () => { void pickFrom('photos'); } },
      { text: 'PDF or file', onPress: () => { void pickFrom('files'); } },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [activeSub, pickFrom]);

  const handleDeleteCoi = useCallback((id: string) => {
    showAlert(
      'Delete this COI?',
      'This removes the certificate from the vault. The sub still exists.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive', onPress: () => {
            ctxRef.current.deleteCOI?.(id);
            updatePending(m => { if (!m[id]) return m; const n = { ...m }; delete n[id]; return n; });
          },
        },
      ],
    );
  }, [updatePending]);

  // The phone detail's upload button and body, hoisted ONCE so the desktop
  // register's record pane shows the same thing (composite-level moves: the
  // phone detail's host tree is unchanged).
  const uploadButton = (
    <TouchableOpacity
      style={[styles.uploadBtn, busy !== null && styles.btnDisabled, isDesktopWeb && styles.uploadBtnDesktop]}
      onPress={handleUpload}
      disabled={busy !== null}
      testID="coi-upload"
      accessibilityRole="button"
      accessibilityLabel={busy === 'uploading' ? 'Uploading certificate' : busy === 'reading' ? 'Reading certificate' : 'Upload COI'}
    >
      {busy
        ? <><ActivityIndicator size="small" color="#fff" /><Text style={styles.uploadBtnText}>{busy === 'uploading' ? 'Uploading…' : 'Reading…'}</Text></>
        : <><Upload size={14} color="#fff" strokeWidth={1.75} /><Text style={styles.uploadBtnText}>Upload COI</Text></>}
    </TouchableOpacity>
  );
  const coiDetailBody = activeSub ? (
    <>
      <View style={styles.titleBlock}>
        <Text style={styles.eyebrow}>Insurance vault</Text>
        <Text style={styles.title}>{activeSub.companyName}</Text>
        <Text style={styles.subtitle}>{subCOIs.length} certificate{subCOIs.length === 1 ? '' : 's'} on file</Text>
      </View>

      {subCOIs.length === 0 ? (
        <View style={styles.emptyState}>
          <MageCOI size={36} color={themeColors.textMuted} />
          <Text style={styles.emptyTitle}>No COIs yet</Text>
          <Text style={styles.emptyBody}>
            Upload the sub&apos;s Certificate of Insurance — a photo or the carrier&apos;s PDF — then record
            each policy&apos;s expiry from it so you&apos;re reminded before it lapses. Anything MAGE ID reads
            off the certificate stays unconfirmed until you check it.
          </Text>
        </View>
      ) : subCOIs.map(coi => (
        <COICard
          key={coi.id}
          coi={coi}
          pendingUpload={pending[coi.id]}
          onDelete={() => handleDeleteCoi(coi.id)}
          onUpdate={(patch) => ctxRef.current.updateCOI?.(coi.id, patch)}
        />
      ))}
    </>
  ) : null;

  // Detail mode
  if (activeSub && !isDesktopWeb) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.detailHeader}>
          <TouchableOpacity onPress={() => setActiveSubId(null)} hitSlop={10} style={styles.headerBack}>
            <ChevronLeft size={22} color={themeColors.accent} strokeWidth={1.75} />
            <Text style={styles.headerBackText}>All subs</Text>
          </TouchableOpacity>
          {uploadButton}
        </View>

        <ScrollView {...fabScroll} contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }} keyboardShouldPersistTaps="handled">
          {coiDetailBody}
        </ScrollView>
      </View>
    );
  }

  // List mode
  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {isDesktopWeb ? (
        <CoiVaultRegister
          subcontractors={subcontractors}
          cois={cois}
          split={split}
          uploadButton={uploadButton}
          detailBody={coiDetailBody}
        />
      ) : (<>
      <Stack.Screen options={{ title: 'Sub Insurance' }} />
      <FeatureHeader
        eyebrow="COI Tracker"
        title="Make sure your subs are insured"
        subtitle="Every sub on your jobsite needs to prove they're covered. Upload their certificate (photo or PDF) and record each policy's expiry — you're reminded 30 days before it lapses."
        explainer={{
          term: 'Certificate of Insurance (COI)',
          definition: 'A COI is a one-page document a subcontractor\'s insurer issues showing what coverage the sub carries — General Liability, Workers\' Comp, Auto, sometimes specialty endorsements like "Additional Insured" naming you. If a sub causes damage or injury and isn\'t insured, it can come back on you.',
          whenToUse: [
            'Before letting a sub start work on your site',
            'Annually when each sub\'s policy renews',
            'When the project owner or your bond requires proof',
          ],
        }}
      />
      {/* Compliance banner — only renders when there's something to act on.
          Three urgency lanes (expired / expiring / missing) shown as colored
          pills so the GC can scan and decide where to spend the next 5min. */}
      {(complianceSummary.expired > 0 || complianceSummary.expiringSoon > 0 || complianceSummary.missing > 0) && (
        <View style={styles.complianceBanner}>
          <AlertTriangle size={16} color={complianceSummary.expired > 0 ? themeColors.dangerLabel : Colors.warning} strokeWidth={2.4} />
          <View style={{ flex: 1 }}>
            <Text style={styles.complianceBannerTitle}>
              {complianceSummary.expired > 0 ? 'Action required' : 'Heads up'}
            </Text>
            <View style={styles.complianceBannerPillRow}>
              {complianceSummary.expired > 0 && (
                <View style={[styles.compliancePill, { backgroundColor: themeColors.dangerSoft }]}>
                  <Text style={[styles.compliancePillText, { color: themeColors.dangerLabel }]}>
                    {complianceSummary.expired} expired
                  </Text>
                </View>
              )}
              {complianceSummary.expiringSoon > 0 && (
                <View style={[styles.compliancePill, { backgroundColor: Colors.warningLight }]}>
                  <Text style={[styles.compliancePillText, { color: Colors.warningLabel }]}>
                    {complianceSummary.expiringSoon} expiring &lt;30d
                  </Text>
                </View>
              )}
              {complianceSummary.missing > 0 && (
                <View style={[styles.compliancePill, { backgroundColor: themeColors.surfaceAlt }]}>
                  <Text style={[styles.compliancePillText, { color: themeColors.textSecondary }]}>
                    {complianceSummary.missing} no COI on file
                  </Text>
                </View>
              )}
            </View>
          </View>
        </View>
      )}

      <View style={styles.listHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.subtitle}>{subcontractors.length} sub{subcontractors.length === 1 ? '' : 's'} tracked</Text>
        </View>
      </View>

      <ScrollView {...fabScroll} contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }}>
        {subcontractors.length === 0 ? (
          <View style={styles.emptyState}>
            <Shield size={36} color={themeColors.textMuted} strokeWidth={1.75} />
            <Text style={styles.emptyTitle}>No subs yet</Text>
            <Text style={styles.emptyBody}>
              Add subs from the Subcontractors screen first, then come back here to upload their COIs.
            </Text>
          </View>
        ) : (
          subcontractors.map(sub => {
            const stat = subStatus.get(sub.id) ?? { worst: 'none' as const };
            const { Icon, color, label } = statusToVisuals(stat.worst, themeColors);
            // The latest certificate's dates, else the date on his record —
            // labelled as such, so a typed date never reads as a checked one.
            const expiry: VaultCoiStatus = vaultCoiStatus(vaultCoiExpiry(stat.latest, sub));
            const expiryColor = expiry.tone === 'bad' ? themeColors.dangerLabel
              : expiry.tone === 'warn' ? themeColors.warningLabel
              : expiry.tone === 'good' ? themeColors.success
              : themeColors.textMuted;
            const expiryBg = expiry.tone === 'bad' ? themeColors.dangerSoft
              : expiry.tone === 'warn' ? themeColors.warningSoft
              : expiry.tone === 'good' ? themeColors.successSoft
              : themeColors.surfaceAlt;
            return (
              <TouchableOpacity
                key={sub.id}
                style={styles.subRow}
                onPress={() => setActiveSubId(sub.id)}
                activeOpacity={0.7}
                testID={`coi-sub-${sub.id}`}
              >
                <View style={[styles.subStatusIcon, { backgroundColor: color + '15' }]}>
                  <Icon size={18} color={color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.subName}>{sub.companyName}</Text>
                  <Text style={styles.subMeta}>
                    {sub.trade}{stat.latest ? ` · last upload ${new Date(stat.latest.uploadedAt).toLocaleDateString()}` : ' · no COI on file'}
                  </Text>
                  <View style={[styles.expiryBadge, { backgroundColor: expiryBg }]}>
                    <Text style={[styles.expiryBadgeText, { color: expiryColor }]}>{expiry.label}</Text>
                  </View>
                </View>
                <View style={[styles.statusPill, { backgroundColor: color + '20' }]}>
                  <Text style={[styles.statusPillText, { color }]}>{label}</Text>
                </View>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>
      </>)}
    </View>
  );
}

// ── Per-COI card (detail view) ──────────────────────────────────

const COVERAGE_TYPES: { key: COICoverageType; label: string }[] = [
  { key: 'general_liability', label: 'General Liability' },
  { key: 'workers_comp', label: "Workers' Comp" },
  { key: 'auto', label: 'Auto' },
  { key: 'umbrella', label: 'Umbrella' },
  { key: 'professional', label: 'Professional' },
  { key: 'pollution', label: 'Pollution' },
  { key: 'other', label: 'Other' },
];

const emptyRow = (): COICoverage => ({ type: 'general_liability', source: 'manual' });

/** A row with nothing typed is dropped on save rather than stored. */
function rowHasContent(c: COICoverage): boolean {
  return !!(c.policyNumber?.trim() || c.carrierName?.trim() || c.expiresAt || c.effectiveDate || c.aiExpiresAt || c.aiEffectiveDate);
}

function COICard({
  coi,
  pendingUpload,
  onDelete,
  onUpdate,
}: {
  coi: CertificateOfInsurance;
  pendingUpload?: PendingCoiUpload;
  onDelete: () => void;
  onUpdate: (patch: Partial<CertificateOfInsurance>) => void;
}) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const v = coi.validation;
  const { Icon, color, label } = statusToVisuals(v?.overallStatus ?? 'warn', themeColors);
  const readUnavailable = (v?.issues ?? []).some(i => i.code === 'ai_validation_unavailable');
  const stored = useMemo(() => coi.coverages ?? [], [coi.coverages]);

  // ── The file ──
  const [file, setFile] = useState<{ state: 'loading' | 'ok' | 'none'; url: string }>({ state: 'loading', url: '' });
  useEffect(() => {
    let alive = true;
    if (!coi.fileUri) {
      setFile({ state: 'none', url: '' });
      return () => { alive = false; };
    }
    setFile({ state: 'loading', url: '' });
    void resolveCoiFileUrl(coi.fileUri).then(url => { if (alive) setFile({ state: url ? 'ok' : 'none', url }); });
    return () => { alive = false; };
  }, [coi.fileUri]);
  const location = coiFileLocation(coi.fileUri);
  const localPreview = !coi.fileUri && pendingUpload && !pendingUpload.lost ? pendingUpload.localUri : '';
  const pdf = isPdfCoiFile(coi.fileUri) || (!!localPreview && pendingUpload?.contentType === 'application/pdf');

  const openFile = useCallback(async (url: string) => {
    try {
      if (Platform.OS === 'web') await Linking.openURL(url);
      else await WebBrowser.openBrowserAsync(url);
    } catch {
      showAlert("Couldn't open the certificate", 'Try again.');
    }
  }, []);

  // ── Coverage rows (the manual path; AI rows land here unconfirmed) ──
  const [draft, setDraft] = useState<COICoverage[]>(() => (stored.length > 0 ? stored : [emptyRow()]));
  const [dirty, setDirty] = useState(false);
  // Beside the desktop register, unsaved coverage rows hold j/k, another row
  // and Esc behind "Discard changes?" (a no-op everywhere else).
  useRegisterRecordDirty(() => dirty);
  // An AI read (or another device's edit) replaces the rows unless the GC is
  // mid-edit — his typing is never overwritten.
  useEffect(() => {
    if (dirty) return;
    setDraft(stored.length > 0 ? stored : [emptyRow()]);
  }, [stored, dirty]);
  const [picking, setPicking] = useState<null | { row: number; field: 'effectiveDate' | 'expiresAt' }>(null);

  const patchRow = useCallback((i: number, patch: Partial<COICoverage>) => {
    setDraft(d => d.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
    setDirty(true);
  }, []);
  // Whole-row replacement — confirmAiCoverage / pickCoverageDate DROP the ai*
  // suggestion keys, which a spread-merge patch would leave behind.
  const replaceRow = useCallback((i: number, row: COICoverage) => {
    setDraft(d => d.map((c, idx) => (idx === i ? row : c)));
    setDirty(true);
  }, []);
  const saveCoverages = useCallback(() => {
    const cleaned = draft.filter(rowHasContent).map(c => ({
      ...c,
      policyNumber: c.policyNumber?.trim() || undefined,
      carrierName: c.carrierName?.trim() || undefined,
    }));
    onUpdate({ coverages: cleaned, validation: recomputeValidation(cleaned, v) });
    setDirty(false);
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [draft, onUpdate, v]);

  // Only a CONFIRMED expiry counts (expiresAt); an AI-read one is a suggestion.
  const noExpiryYet = !draft.some(c => !!c.expiresAt);
  const aiExpiryWaiting = draft.some(c => !c.expiresAt && !!c.aiExpiresAt);

  return (
    <View style={styles.coiCard}>
      <View style={styles.coiHeader}>
        <View style={[styles.coiStatusIcon, { backgroundColor: color + '15' }]}>
          <Icon size={16} color={color} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.coiTitle}>Certificate uploaded {new Date(coi.uploadedAt).toLocaleDateString()}</Text>
          <Text style={styles.coiMeta}>{label}{v?.confidence != null ? ` · AI confidence ${v.confidence}%` : ''}</Text>
        </View>
        <TouchableOpacity onPress={onDelete} hitSlop={6} style={styles.deleteBtn} accessibilityRole="button" accessibilityLabel="Delete"><Trash2 size={14} color={themeColors.dangerLabel} strokeWidth={1.75} /></TouchableOpacity>
      </View>

      {/* The file: stored (signed on view), waiting on this phone, or gone. */}
      {localPreview ? (
        <View>
          {pdf ? (
            <View style={styles.fileRow}><FileText size={16} color={themeColors.textSecondary} strokeWidth={1.75} /><Text style={styles.fileRowText}>PDF certificate</Text></View>
          ) : (
            <Image source={{ uri: localPreview }} style={styles.coiImage} resizeMode="contain" />
          )}
          <Text style={styles.fileNote} testID="coi-not-uploaded">Not uploaded yet — only on this phone. It uploads the next time you open the vault online.</Text>
        </View>
      ) : pendingUpload?.lost && !coi.fileUri ? (
        <Text style={styles.fileNote} testID="coi-file-lost">The picked file was cleared from this phone before it uploaded — delete this certificate and upload it again.</Text>
      ) : file.state === 'loading' ? (
        <ActivityIndicator style={{ marginTop: 10 }} color={themeColors.textMuted} />
      ) : file.state === 'ok' ? (
        pdf ? (
          <TouchableOpacity style={styles.fileRow} onPress={() => { void openFile(file.url); }} accessibilityRole="button" accessibilityLabel="Open certificate" testID="coi-open-pdf">
            <FileText size={16} color={themeColors.accent} strokeWidth={1.75} />
            <Text style={[styles.fileRowText, { color: themeColors.accent }]}>Open certificate</Text>
          </TouchableOpacity>
        ) : (
          <Image source={{ uri: file.url }} style={styles.coiImage} resizeMode="contain" />
        )
      ) : (
        <Text style={styles.fileNote} testID="coi-file-missing">
          {location === 'stored'
            ? "Couldn't load the certificate file — you may be offline. Reopen the vault to try again."
            : !coi.fileUri
              ? 'Certificate file not on this device — it is waiting to upload from the phone that picked it, or re-upload it here.'
              : 'Certificate file not on this device — re-upload it.'}
        </Text>
      )}

      {/* Validation findings */}
      {v?.issues && v.issues.length > 0 ? (
        <View style={styles.findingsCard}>
          <Text style={styles.findingsLabel}>Findings</Text>
          {v.issues.map((iss, i) => {
            const sevColor = iss.severity === 'critical' ? themeColors.dangerLabel
                            : iss.severity === 'warning' ? Colors.warning
                            : neutralInk(themeColors);
            return (
              <View key={i} style={styles.findingRow}>
                <View style={[styles.findingDot, { backgroundColor: sevColor }]} />
                <Text style={styles.findingText}>{iss.message}</Text>
              </View>
            );
          })}
        </View>
      ) : v?.overallStatus === 'pass' ? (
        <View style={[styles.findingsCard, { borderColor: themeColors.success + '30' }]}>
          <Text style={[styles.findingsLabel, { color: themeColors.successLabel }]}>No findings</Text>
          <Text style={styles.findingText}>Every coverage on file is in date.</Text>
        </View>
      ) : null}

      {/* Coverages — typed by the GC, or read by AI and shown unconfirmed */}
      <View style={styles.coveragesCard} testID="coi-coverages">
        <Text style={styles.findingsLabel}>Coverages</Text>
        {noExpiryYet ? (
          <Text style={styles.promptText}>
            {aiExpiryWaiting
              ? 'Check the AI-read expiry against the certificate and tap Confirm'
              : readUnavailable || stored.length === 0 ? 'Type the expiry from the certificate' : 'Add the expiry date for at least one policy'}
            {' '}— a confirmed expiry sets the sub&apos;s COI expiry and turns on the 30 / 14 / 7-day reminders.
          </Text>
        ) : null}
        {draft.map((c, i) => (
          <View key={i} style={styles.coverageEditRow}>
            {hasUnconfirmedAi(c) ? (
              <View style={styles.unconfirmedRow}>
                <Text style={styles.unconfirmedText}>Read by AI — unconfirmed, not counted yet</Text>
                <TouchableOpacity
                  onPress={() => replaceRow(i, confirmAiCoverage(c))}
                  testID={`coi-confirm-${i}`}
                  style={styles.confirmBtn}
                  accessibilityRole="button"
                  accessibilityLabel="Confirm this coverage matches the certificate"
                >
                  <CheckCircle2 size={12} color={themeColors.successLabel} strokeWidth={1.75} />
                  <Text style={[styles.confirmBtnText, { color: themeColors.successLabel }]}>Confirm</Text>
                </TouchableOpacity>
              </View>
            ) : null}
            <ChipRail contentContainerStyle={{ gap: 6 }}>
              {COVERAGE_TYPES.map(t => (
                <TouchableOpacity
                  key={t.key}
                  onPress={() => patchRow(i, { type: t.key })}
                  style={[styles.typeChip, c.type === t.key && styles.typeChipActive]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: c.type === t.key }}
                >
                  <Text style={[styles.typeChipText, c.type === t.key && styles.typeChipTextActive]}>{t.label}</Text>
                </TouchableOpacity>
              ))}
            </ChipRail>
            <View style={styles.inlineRow}>
              <TextInput
                style={[styles.notesInput, styles.inlineInput]}
                value={c.policyNumber ?? ''}
                onChangeText={t => patchRow(i, { policyNumber: t })}
                placeholder="Policy #"
                placeholderTextColor={themeColors.textMuted}
                autoCapitalize="characters"
              />
              <TextInput
                style={[styles.notesInput, styles.inlineInput]}
                value={c.carrierName ?? ''}
                onChangeText={t => patchRow(i, { carrierName: t })}
                placeholder="Carrier"
                placeholderTextColor={themeColors.textMuted}
              />
            </View>
            <View style={styles.inlineRow}>
              <TouchableOpacity style={styles.dateBtn} onPress={() => setPicking({ row: i, field: 'effectiveDate' })} accessibilityRole="button" accessibilityLabel="Effective date">
                <Calendar size={13} color={themeColors.textSecondary} strokeWidth={1.75} />
                <Text style={[styles.dateBtnText, !c.effectiveDate && !!c.aiEffectiveDate && { color: themeColors.warningLabel }]}>
                  {c.effectiveDate
                    ? `Effective ${formatCalendarDay(c.effectiveDate)}`
                    : c.aiEffectiveDate ? `AI read: effective ${formatCalendarDay(c.aiEffectiveDate)} — unconfirmed` : 'Effective date'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.dateBtn} onPress={() => setPicking({ row: i, field: 'expiresAt' })} accessibilityRole="button" accessibilityLabel="Expiry date" testID={`coi-expiry-${i}`}>
                <Calendar size={13} color={c.expiresAt ? themeColors.text : themeColors.accent} strokeWidth={1.75} />
                <Text style={[styles.dateBtnText, !c.expiresAt && { color: c.aiExpiresAt ? themeColors.warningLabel : themeColors.accent }]}>
                  {c.expiresAt
                    ? `Expires ${formatCalendarDay(c.expiresAt)}`
                    : c.aiExpiresAt ? `AI read: expires ${formatCalendarDay(c.aiExpiresAt)} — unconfirmed` : 'Expiry date'}
                </Text>
              </TouchableOpacity>
              {draft.length > 1 ? (
                <TouchableOpacity onPress={() => { setDraft(d => d.filter((_, idx) => idx !== i)); setDirty(true); }} hitSlop={6} accessibilityRole="button" accessibilityLabel="Remove this coverage">
                  <Trash2 size={13} color={themeColors.textMuted} strokeWidth={1.75} />
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        ))}
        <View style={styles.inlineRow}>
          <TouchableOpacity onPress={() => { setDraft(d => [...d, emptyRow()]); setDirty(true); }} style={styles.addRowBtn} accessibilityRole="button">
            <Plus size={13} color={themeColors.accent} strokeWidth={1.75} />
            <Text style={[styles.addRowText, { color: themeColors.accent }]}>Add coverage</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={saveCoverages}
            disabled={!dirty}
            style={[styles.saveRowBtn, !dirty && styles.btnDisabled]}
            accessibilityRole="button"
            accessibilityState={{ disabled: !dirty }}
            testID="coi-save-coverages"
          >
            <Text style={styles.uploadBtnText}>{dirty ? 'Save coverages' : stored.length > 0 ? 'Saved' : 'Save coverages'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      <DatePickerModal
        visible={picking !== null}
        // An AI-read day pre-fills the picker; it only becomes the policy's
        // date when the GC picks it (pickCoverageDate).
        value={picking ? (draft[picking.row]?.[picking.field]
          ?? draft[picking.row]?.[picking.field === 'expiresAt' ? 'aiExpiresAt' : 'aiEffectiveDate'] ?? '') : ''}
        allowFuture
        title={picking?.field === 'effectiveDate' ? 'Policy effective' : 'Policy expires'}
        onClose={() => setPicking(null)}
        onChange={(iso) => {
          // DatePickerModal emits noon-UTC of the picked day, so the date part
          // IS the picked calendar day in every timezone.
          if (picking) {
            const row = draft[picking.row];
            if (row) replaceRow(picking.row, pickCoverageDate(row, picking.field, iso.slice(0, 10)));
          }
        }}
      />

      {/* Notes */}
      <Text style={styles.notesLabel}>Notes</Text>
      <TextInput
        style={styles.notesInput}
        value={coi.notes ?? ''}
        onChangeText={t => onUpdate({ notes: t })}
        placeholder="Anything specific about this COI..."
        placeholderTextColor={themeColors.textMuted}
        multiline
      />
    </View>
  );
}

// ── Helpers ──────────────────────────────────────────────────────

// Takes the theme because 'none' is the NEUTRAL, and a neutral has to invert
// between themes. It returned the dark theme's textSecondary (#9AA3AD), which
// is the colour of the "No COI" label AND of the icon on its own `+ '15'` wash
// — 2.5:1 on a light card, on the row that says a sub is uninsured.
function statusToVisuals(s: 'pass' | 'warn' | 'fail' | 'none', t: ThemeColors): {
  Icon: typeof Shield;
  color: string;
  label: string;
} {
  switch (s) {
    case 'pass': return { Icon: ShieldCheck, color: "#2E7D44",        label: 'Valid' };
    case 'warn': return { Icon: ShieldAlert, color: Colors.warningLabel,        label: 'Review needed' };
    case 'fail': return { Icon: ShieldX,     color: "#C84038",          label: 'Action required' };
    case 'none':
    default:     return { Icon: Shield,      color: neutralInk(t),      label: 'No COI' };
  }
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  complianceBanner: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: 10,
    marginHorizontal: 16,
    marginTop: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: Tokens.radius.panel,
    backgroundColor: t.surface,
    borderWidth: 1,
    borderColor: t.line,
  },
  complianceBannerTitle: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '700' as const,
    color: t.text,
    marginBottom: 6,
  },
  complianceBannerPillRow: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 6,
  },
  compliancePill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  compliancePillText: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '700' as const,
    letterSpacing: 0.1,
  },
  container: { flex: 1, backgroundColor: t.bg },
  emptyState: { alignItems: 'center', paddingTop: 60, gap: 10 },
  emptyTitle: { fontSize: Type.subheadline.fontSize, fontWeight: '800' as const, color: t.text },
  emptyBody: { fontSize: Type.footnote.fontSize, color: t.textSecondary, textAlign: 'center', lineHeight: 19, paddingHorizontal: 32 },

  listHeader: {
    paddingHorizontal: 16,
    paddingTop: 12, paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: t.line,
  },
  eyebrow: {
    fontSize: 10, fontWeight: '800' as const, color: t.textMuted,
    letterSpacing: 0.7, textTransform: 'uppercase' as const,
  },
  title: { ...Type.serifHeadline, color: t.text, marginTop: 2 },
  subtitle: { fontSize: Type.caption1.fontSize, color: t.textMuted, marginTop: 2 },

  subRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.card, padding: 12, marginBottom: 8,
    borderWidth: 1, borderColor: t.line,
  },
  subStatusIcon: {
    width: 40, height: 40, borderRadius: Tokens.radius.card,
    alignItems: 'center', justifyContent: 'center',
  },
  subName: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: t.text },
  subMeta: { fontSize: Type.caption2.fontSize, color: t.textMuted, marginTop: 2 },
  statusPill: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: Tokens.radius.full,
  },
  statusPillText: { fontSize: 10, fontWeight: '800' as const, letterSpacing: 0.4, textTransform: 'uppercase' as const },
  expiryBadge: {
    alignSelf: 'flex-start' as const,
    paddingHorizontal: 7, paddingVertical: 2,
    borderRadius: Tokens.radius.full,
    marginTop: 5,
  },
  expiryBadgeText: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const },

  detailHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: t.line,
    gap: 12,
  },
  headerBack: { flexDirection: 'row', alignItems: 'center', gap: 4, flex: 1 },
  headerBackText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600' as const, color: t.accent },
  uploadBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    paddingHorizontal: 12, paddingVertical: 8,
    backgroundColor: t.accentFill, borderRadius: Tokens.radius.md,
  },
  uploadBtnText: { color: '#fff', fontWeight: '800' as const, fontSize: Type.caption1.fontSize },
  // Desktop web (the record pane's header row): a button, not a stretched bar.
  uploadBtnDesktop: { alignSelf: 'flex-start' as const, height: Layout.control.md },
  btnDisabled: { opacity: 0.5 },
  titleBlock: { marginBottom: 16 },

  coiCard: {
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.lg,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1, borderColor: t.line,
  },
  coiHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10 },
  coiStatusIcon: { width: 32, height: 32, borderRadius: Tokens.radius.md, alignItems: 'center' as const, justifyContent: 'center' as const },
  coiTitle: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: t.text },
  coiMeta: { fontSize: Type.caption2.fontSize, color: t.textMuted, marginTop: 2 },
  deleteBtn: { padding: 6 },
  coiImage: {
    width: '100%' as const,
    height: 200,
    backgroundColor: t.bg,
    borderRadius: Tokens.radius.md, marginTop: 10,
  },

  findingsCard: {
    backgroundColor: t.bg,
    borderRadius: Tokens.radius.md, padding: 12,
    marginTop: 10,
    borderWidth: 1, borderColor: t.line,
  },
  findingsLabel: {
    fontSize: 10, fontWeight: '800' as const, color: t.textMuted,
    letterSpacing: 0.7, textTransform: 'uppercase' as const,
    marginBottom: 6,
  },
  findingRow: { flexDirection: 'row' as const, gap: 8, paddingVertical: 4, alignItems: 'flex-start' as const },
  findingDot: { width: 6, height: 6, borderRadius: 3, marginTop: 6 },
  findingText: { flex: 1, fontSize: Type.caption1.fontSize, color: t.text, lineHeight: 16 },

  coveragesCard: {
    backgroundColor: t.bg,
    borderRadius: Tokens.radius.md, padding: 12, marginTop: 8,
    borderWidth: 1, borderColor: t.line,
  },
  coverageEditRow: {
    paddingVertical: 8, gap: 6,
    borderTopWidth: 1, borderTopColor: t.line,
  },
  promptText: { fontSize: Type.caption1.fontSize, color: t.text, lineHeight: 17, marginBottom: 4 },
  unconfirmedRow: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const },
  unconfirmedText: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const, color: t.warningLabel },
  confirmBtn: {
    ...cardSurface(t, { radius: 'full', pad: 'none' }),
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4,
    paddingHorizontal: 10, paddingVertical: 5,
  },
  confirmBtnText: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const },
  typeChip: {
    ...cardSurface(t, { radius: 'full', pad: 'none' }),
    paddingHorizontal: 10, paddingVertical: 5,
  },
  typeChipActive: { backgroundColor: t.accentFill, borderColor: t.accentFill },
  typeChipText: { fontSize: Type.caption2.fontSize, fontWeight: '600' as const, color: t.textSecondary },
  typeChipTextActive: { color: '#fff' },
  inlineRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8 },
  inlineInput: { flex: 1, minHeight: 40 },
  dateBtn: {
    ...cardSurface(t, { radius: 'md', pad: 10 }),
    flex: 1, flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6,
  },
  dateBtnText: { fontSize: Type.caption1.fontSize, color: t.text, flexShrink: 1 },
  addRowBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4, paddingVertical: 10, flex: 1 },
  addRowText: { fontSize: Type.caption1.fontSize, fontWeight: '700' as const },
  saveRowBtn: {
    paddingHorizontal: 14, paddingVertical: 9,
    backgroundColor: t.accentFill, borderRadius: Tokens.radius.md,
  },
  fileRow: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8,
    marginTop: 10, paddingVertical: 12, paddingHorizontal: 12,
    borderRadius: Tokens.radius.md, borderWidth: 1, borderColor: t.line, backgroundColor: t.bg,
  },
  fileRowText: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: t.text },
  fileNote: { fontSize: Type.caption1.fontSize, color: t.textSecondary, marginTop: 8, lineHeight: 17 },

  notesLabel: {
    fontSize: 10, fontWeight: '800' as const, color: t.textMuted,
    letterSpacing: 0.7, textTransform: 'uppercase' as const,
    marginTop: 12, marginBottom: 5,
  },
  notesInput: {
    backgroundColor: t.bg,
    borderWidth: 1, borderColor: t.line,
    borderRadius: Tokens.radius.md, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: Type.caption1.fontSize, color: t.text,
    minHeight: 50,
  },
});
