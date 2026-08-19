// cost-xray.tsx — scan an older home, price the hidden conditions before you bid.
//
// Flow: capture photos (expo-image-picker, saved as ProjectPhotos tagged
// "Cost X-Ray") → detect hidden-condition tells (analyze-photos edge fn,
// task 'conditionRisk') → price each tell as a probability-weighted allowance
// on the contractor's learned costs (utils/costXray.priceTell over the
// buildCostDatabase engine) → per-tell Accept / Edit / Reject review → on
// "Add to estimate" inject GC-only "Hidden Conditions" contingency lines
// (commitEstimatePatch) plus a field-verify PunchItem per accepted tell.
//
// Pure pricing lives in utils/costXray; detection is server-side. Business
// tier; OTA-safe (no new native modules).

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Image, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import {
  ScanSearch, ChevronLeft, Camera, ImagePlus, Check, X, Pencil,
  AlertTriangle, WifiOff, ShieldAlert, Zap, Droplets, Building2,
  type LucideIcon,
} from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { useMaterialReceipts } from '@/hooks/useMaterialReceipts';
import { useCostSeeds } from '@/hooks/useCostSeeds';
import { useTierAccess } from '@/hooks/useTierAccess';
import { invokeWithTimeout } from '@/utils/invokeWithTimeout';
import { buildCostDatabase } from '@/utils/costDatabase';
import { priceTell, routeByConfidence, verifyOnlyReason, normalizeTells } from '@/utils/costXray';
import type { ConditionTell, PricedTell } from '@/utils/costXray';
import { commitEstimatePatch } from '@/utils/estimateCommit';
import { createId } from '@/utils/scheduleEngine';
import { formatMoney } from '@/utils/jobCostEngine';
import type {
  LinkedEstimate, LinkedEstimateItem, CostXrayMeta, XrayCategory,
} from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { Colors } from '@/constants/colors';
import { showAlert } from '@/utils/alert';

// A captured photo (id === the saved ProjectPhoto.id so tell provenance lines up).
interface CapturedPhoto { id: string; uri: string; timestamp: string }

type Band = { low: number; expected: number; high: number };

// One detected tell as it moves through the review. `tell.photoIndex` is already
// remapped to an index into the local `photos` array. `qty`/`unitPrice` are the
// GC-editable knobs; `origBand` is the un-edited priced band we scale from.
interface ReviewTell {
  id: string;
  tell: ConditionTell;
  route: 'price' | 'verify-only';
  category: XrayCategory;
  origBand: Band;
  hasLearnedRate: boolean;
  /** Which kind of rate priced it — see PricedTell.rateBasis. A seeded rate is
   *  the GC's own claim and must never be captioned as their job history. */
  rateBasis: PricedTell['rateBasis'];
  sourcePhotoId: string;
  sourcePhotoUri: string;
  status: 'pending' | 'accepted' | 'rejected';
  qty: number;
  unitPrice: number;
}

const CAT_ICON: Record<XrayCategory, LucideIcon> = {
  electrical: Zap,
  plumbing: Droplets,
  structural: Building2,
  moisture: Droplets,
};

const CAT_LABEL: Record<XrayCategory, string> = {
  electrical: 'Electrical',
  plumbing: 'Plumbing',
  structural: 'Structural',
  moisture: 'Moisture',
};

/** How the allowance was priced, in the contractor's words. 'seeded' gets its
 *  own phrasing on purpose: a rate they typed is theirs, but it is not history,
 *  and captioning it as history is the one thing that would make the whole cost
 *  book untrustworthy. 'mixed' has real closed jobs behind it, so it reads as
 *  history. */
const RATE_BASIS_LABEL: Record<PricedTell['rateBasis'], string> = {
  earned: 'your job history',
  mixed: 'your job history',
  seeded: 'the rate you set yourself',
  catalog: 'a catalog allowance',
};

const MAX_PHOTOS = 8;
// Must match the server-side MAX_INLINE_BYTES_TOTAL in analyze-photos edge fn.
const MAX_PAYLOAD_BYTES = 8 * 1024 * 1024;

/** The GC-edited allowance band. Scales the original priced band's spread to the
 *  new expected (qty × $/unit) so low/high stay meaningful after an override. */
function effectiveBand(r: ReviewTell): Band {
  const expected = Math.round(r.qty * r.unitPrice);
  if (r.origBand.expected <= 0) return { low: 0, expected, high: expected };
  const f = expected / r.origBand.expected;
  return { low: Math.round(r.origBand.low * f), expected, high: Math.round(r.origBand.high * f) };
}

export default function CostXrayScreen() {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ projectId?: string }>();
  const { canAccess } = useTierAccess();
  const { projects, commitments, updateProject, addProjectPhoto, deleteProjectPhoto, addPunchItem } = useProjects();
  const { receipts } = useMaterialReceipts();
  // Cold-start seeds. Cost X-Ray is the most visible AI surface after the
  // estimate: without these, a contractor who pasted their whole rate sheet
  // still gets every hidden-condition allowance priced off a generic catalog
  // number rather than their own.
  const { seeds } = useCostSeeds();

  // Business gate — redirect locked tiers to the paywall (design decision 3).
  const locked = !canAccess('cost_xray');
  useEffect(() => {
    if (locked) router.replace('/paywall');
  }, [locked, router]);

  // Resolve the target project: route param first, else the current estimate's
  // project (most recent linkedEstimate), else the first project.
  const initialProjectId =
    params.projectId ?? projects.find(p => !!p.linkedEstimate)?.id ?? projects[0]?.id ?? '';
  const [projectId, setProjectId] = useState(initialProjectId);
  const project = useMemo(() => projects.find(p => p.id === projectId) ?? null, [projects, projectId]);

  // Projects may hydrate after mount (initial state above captured an empty list).
  // Default to the current estimate's project once they land so single-project
  // users — who never see the picker — still have a target.
  useEffect(() => {
    if (!projectId && projects.length > 0) {
      setProjectId(projects.find(p => !!p.linkedEstimate)?.id ?? projects[0].id);
    }
  }, [projectId, projects]);

  // The cost-learning engine — same source estimate-confidence uses.
  const db = useMemo(() => buildCostDatabase(projects, commitments, receipts, [], seeds), [projects, commitments, receipts, seeds]);

  const [photos, setPhotos] = useState<CapturedPhoto[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false); // detection failed on connectivity
  const [reviews, setReviews] = useState<ReviewTell[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);

  const resetScan = useCallback(() => {
    setReviews([]);
    setError(null);
    setPending(false);
    setEditingId(null);
  }, []);

  // ── Capture ──────────────────────────────────────────────────────────
  const addCaptured = useCallback((uri: string) => {
    if (!project) return;
    const id = createId('photo');
    const timestamp = new Date().toISOString();
    setPhotos(prev => [...prev, { id, uri, timestamp }]);
    addProjectPhoto({ id, projectId: project.id, uri, timestamp, tag: 'Cost X-Ray', createdAt: timestamp });
    resetScan();
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [project, addProjectPhoto, resetScan]);

  const capture = useCallback(async (source: 'camera' | 'library') => {
    if (!project) { showAlert('Pick a project', 'Choose which project this scan is for.'); return; }
    if (photos.length >= MAX_PHOTOS) { showAlert('Limit reached', `Up to ${MAX_PHOTOS} photos per scan.`); return; }
    try {
      if (source === 'camera') {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) { showAlert('Camera access needed', 'Grant camera access in Settings.'); return; }
        const res = await ImagePicker.launchCameraAsync({ quality: 0.7 });
        if (res.canceled || !res.assets[0]) return;
        addCaptured(res.assets[0].uri);
      } else {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) { showAlert('Photo access needed', 'Grant photo access in Settings.'); return; }
        const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.7 });
        if (res.canceled || !res.assets[0]) return;
        addCaptured(res.assets[0].uri);
      }
    } catch (e) {
      setError(`Couldn't open the ${source}: ${String((e as Error).message ?? e)}`);
    }
  }, [project, photos.length, addCaptured]);

  const removePhoto = useCallback((id: string) => {
    setPhotos(prev => prev.filter(p => p.id !== id));
    // The photo was persisted on capture; discarding it here must also remove the
    // ProjectPhoto so a scrapped shot doesn't linger as an orphan in the gallery.
    deleteProjectPhoto(id);
    resetScan();
  }, [deleteProjectPhoto, resetScan]);

  // ── Detect + price ───────────────────────────────────────────────────
  const detect = useCallback(async () => {
    if (busy || photos.length === 0) return;
    setBusy(true);
    setError(null);
    setPending(false);
    setReviews([]);
    try {
      // Encode locally to inline base64 — mirrors utils/photoAnalyzer. allSettled
      // so one unreadable URI doesn't sink the batch; originalIndex remaps the
      // model's photoIndex back to the local photos array.
      const settled = await Promise.allSettled(photos.map(async (p) => {
        const base64 = await FileSystem.readAsStringAsync(p.uri, { encoding: 'base64' });
        const ext = p.uri.split('.').pop()?.toLowerCase() ?? '';
        const mimeType = ext === 'png' ? 'image/png' : ext === 'heic' ? 'image/heic' : 'image/jpeg';
        return { base64, mimeType };
      }));
      const inline: { base64: string; mimeType: string }[] = [];
      const originalIndex: number[] = [];
      settled.forEach((r, i) => {
        if (r.status === 'fulfilled') { inline.push(r.value); originalIndex.push(i); }
      });
      if (inline.length === 0) {
        setError('Could not read the captured photos — they may have been moved. Retake and try again.');
        return;
      }

      // Client-side payload guard — mirrors the server's MAX_INLINE_BYTES_TOTAL.
      // Catches oversized batches before the round-trip so the user doesn't wait
      // 15-30 s only to get a 413 back.
      const payloadBytes = inline.reduce((s, p) => s + p.base64.length, 0);
      if (payloadBytes > MAX_PAYLOAD_BYTES) {
        showAlert(
          'Photos too large',
          `Your photos are too large to analyze (${(payloadBytes / 1024 / 1024).toFixed(1)} MB). Try fewer photos or use the camera option — it captures at a smaller file size. Max batch size is 8 MB.`,
        );
        return;
      }

      const { data: res, error: fnErr } = await invokeWithTimeout<{
        success: boolean; data?: { items?: unknown[] }; error?: string;
      }>('analyze-photos', { body: { task: 'conditionRisk', photos: inline, projectName: project?.name } });
      if (fnErr) throw new Error(fnErr.message);
      if (!res?.success) throw new Error(res?.error ?? 'The scan came back empty.');

      const tells = normalizeTells(res.data?.items);
      const built: ReviewTell[] = [];
      for (const raw of tells) {
        const origIdx = originalIndex[raw.photoIndex];
        if (origIdx == null) continue; // model returned an out-of-bounds photoIndex
        const src = photos[origIdx];
        if (!src) continue;
        const remapped: ConditionTell = { ...raw, photoIndex: origIdx };
        const priced = priceTell(remapped, db);
        built.push({
          id: createId('xrayrev'),
          tell: remapped,
          route: routeByConfidence(remapped),
          category: remapped.category,
          origBand: priced.band,
          hasLearnedRate: priced.hasLearnedRate,
          rateBasis: priced.rateBasis,
          sourcePhotoId: src.id,
          sourcePhotoUri: src.uri,
          status: 'pending',
          qty: 1,
          unitPrice: priced.band.expected,
        });
      }
      setReviews(built);
      if (built.length === 0) {
        setError('No hidden conditions detected in these shots. For better results, try a closer shot of the panel edges, look for water staining on the basement wall, or shoot in brighter light — then scan again.');
      } else if (Platform.OS !== 'web') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch {
      // Photos are already saved to the project — surface a retryable pending state.
      setPending(true);
      setError("Scan couldn't finish — you may be offline or over your monthly limit. Your photos are saved; run the scan again when you're back online.");
    } finally {
      setBusy(false);
    }
  }, [busy, photos, project?.name, db]);

  // ── Review actions ───────────────────────────────────────────────────
  const patchReview = useCallback((id: string, updates: Partial<ReviewTell>) => {
    setReviews(prev => prev.map(r => (r.id === id ? { ...r, ...updates } : r)));
  }, []);

  const accepted = useMemo(() => reviews.filter(r => r.status === 'accepted'), [reviews]);
  const acceptedContingency = useMemo(
    () => accepted.filter(r => r.route === 'price').reduce((s, r) => s + effectiveBand(r).expected, 0),
    [accepted],
  );

  // ── Apply ────────────────────────────────────────────────────────────
  const applyToEstimate = useCallback(() => {
    if (accepted.length === 0 || !project) return;
    const now = new Date().toISOString();

    // Priced tells → GC-only "Hidden Conditions" contingency lines on the estimate.
    const pricedAccepted = accepted.filter(r => r.route === 'price');
    if (pricedAccepted.length > 0) {
      if (!project.linkedEstimate) {
        showAlert(
          'No estimate yet',
          "This project has no linked estimate to add lines to. The field-verify tasks will still be created.",
        );
      } else {
        const est = project.linkedEstimate;
        const newItems: LinkedEstimateItem[] = pricedAccepted.map((r) => {
          const band = effectiveBand(r);
          const meta: CostXrayMeta = {
            sourcePhotoId: r.sourcePhotoId, bbox: r.tell.bbox, tell: r.tell.tell,
            category: r.category, confidence: r.tell.confidence, band, clientVisible: false,
          };
          return {
            materialId: createId('xray'),
            name: r.tell.tell,
            category: 'Hidden Conditions',
            unit: 'ea',
            quantity: 1,
            unitPrice: band.expected,
            bulkPrice: band.expected,
            markup: 0,
            usesBulk: false,
            lineTotal: band.expected,
            supplier: '',
            isAllowance: true,
            xray: meta,
          };
        });
        // Contingency lines carry no markup (they're already probability-weighted
        // expected values), so they add to base + grand equally and leave the
        // markup subtotal untouched. Incremental — preserves any markup earlier
        // takeoff/plan flows already baked into the stored totals.
        const added = newItems.reduce((s, i) => s + i.lineTotal, 0);
        const nextEstimate: LinkedEstimate = {
          ...est,
          items: [...est.items, ...newItems],
          baseTotal: est.baseTotal + added,
          grandTotal: est.grandTotal + added,
        };
        updateProject(project.id, commitEstimatePatch(project, nextEstimate, {
          reason: 'xray', note: 'Cost X-Ray hidden-condition scan',
        }));
      }
    }

    // Every accepted tell (priced + verify-only) → a field-verify task.
    for (const r of accepted) {
      const band = effectiveBand(r);
      const meta: CostXrayMeta = {
        sourcePhotoId: r.sourcePhotoId, bbox: r.tell.bbox, tell: r.tell.tell,
        category: r.category, confidence: r.tell.confidence, band, clientVisible: false,
      };
      addPunchItem({
        id: createId('punch'),
        projectId: project.id,
        description: 'Verify before demo/order: ' + r.tell.tell,
        location: '',
        assignedSub: '',
        dueDate: '',
        priority: 'medium',
        status: 'open',
        photoUri: r.sourcePhotoUri,
        createdAt: now,
        updatedAt: now,
        xray: meta,
      });
    }

    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    // Confirm what landed before dismissing — mirrors the pattern in takeoff-estimate.tsx.
    const pricedCount = pricedAccepted.length;
    const totalAdded = pricedAccepted.reduce((s, r) => s + effectiveBand(r).expected, 0);
    const verifyOnlyCount = accepted.filter(r => r.route === 'verify-only').length;
    const parts: string[] = [];
    if (pricedCount > 0) parts.push(`${pricedCount} hidden-condition line${pricedCount === 1 ? '' : 's'} (+${formatMoney(totalAdded)}) added to your estimate.`);
    if (verifyOnlyCount > 0) parts.push(`${verifyOnlyCount} field-verify task${verifyOnlyCount === 1 ? '' : 's'} created.`);
    showAlert(
      `${accepted.length} condition${accepted.length === 1 ? '' : 's'} applied`,
      parts.join(' '),
      [{ text: 'Done', onPress: () => router.back() }],
    );
  }, [accepted, project, updateProject, addPunchItem, router]);

  // Locked tiers see nothing while the redirect runs.
  if (locked) {
    return (
      <View style={styles.root}>
        <Stack.Screen options={{ headerShown: false }} />
      </View>
    );
  }

  const hasReviews = reviews.length > 0;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
          <ChevronLeft size={22} color={t.text} strokeWidth={1.75} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.headerEyebrow}>Cost X-Ray · MAGE ID</Text>
          <Text style={styles.headerTitle} numberOfLines={1}>{project?.name ?? 'Price the hidden conditions'}</Text>
        </View>
        <View style={styles.headerBtn} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120 + insets.bottom }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {/* Project picker */}
        {projects.length > 1 && !hasReviews && (
          <View style={styles.pickerWrap}>
            <Text style={styles.pickerLabel}>Project</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {projects.map(p => (
                <TouchableOpacity
                  key={p.id}
                  onPress={() => { setProjectId(p.id); setPhotos([]); resetScan(); }}
                  style={[styles.chip, projectId === p.id && styles.chipOn]}
                >
                  <Text style={[styles.chipText, projectId === p.id && styles.chipTextOn]} numberOfLines={1}>{p.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {/* Intro */}
        {photos.length === 0 && (
          <View style={styles.introCard}>
            <ScanSearch size={20} color={t.accent} strokeWidth={1.75} />
            <View style={{ flex: 1, gap: 10 }}>
              <Text style={styles.introText}>
                Photograph the panel, supply lines, waste stack, foundation, or any water staining. MAGE flags the costly hidden conditions and prices each as a contingency on <Text style={styles.introEmph}>your</Text> learned costs — before you commit a number.
              </Text>
              <View style={styles.tipsBox}>
                <Text style={styles.tipsLabel}>For best results</Text>
                {([
                  'Get the whole panel or area in frame',
                  'Capture water stains clearly — fill the shot',
                  'Zoom in on wire type or pipe material',
                  'Shoot in good light (avoid harsh shadows)',
                ] as const).map((tip) => (
                  <View key={tip} style={styles.tipRow}>
                    <View style={styles.tipDot} />
                    <Text style={styles.tipText}>{tip}</Text>
                  </View>
                ))}
              </View>
            </View>
          </View>
        )}

        {/* Captured thumbnails */}
        {photos.length > 0 && (
          <View style={styles.thumbsRow}>
            {photos.map(p => (
              <View key={p.id} style={styles.thumbWrap}>
                <Image source={{ uri: p.uri }} style={styles.thumb} resizeMode="cover" />
                {!hasReviews && (
                  <TouchableOpacity onPress={() => removePhoto(p.id)} style={styles.thumbDel} hitSlop={8} accessibilityRole="button" accessibilityLabel="Remove photo">
                    <X size={12} color={Colors.textOnAccent} strokeWidth={2.25} />
                  </TouchableOpacity>
                )}
              </View>
            ))}
          </View>
        )}

        {/* Capture buttons + count badge */}
        {!hasReviews && (
          <View style={{ gap: 8 }}>
            <View style={styles.captureHeaderRow}>
              <Text style={styles.photoCountBadge}>{photos.length}/{MAX_PHOTOS} photos</Text>
              {photos.length >= MAX_PHOTOS && (
                <Text style={styles.photoCountMax}>Maximum reached</Text>
              )}
            </View>
            <View style={[styles.captureRow, photos.length >= MAX_PHOTOS && { opacity: 0.38 }]}>
              <TouchableOpacity
                style={styles.captureBtn}
                onPress={() => capture('camera')}
                activeOpacity={0.85}
                disabled={photos.length >= MAX_PHOTOS}
                accessibilityState={{ disabled: photos.length >= MAX_PHOTOS }}
              >
                <Camera size={22} color={photos.length >= MAX_PHOTOS ? t.textMuted : t.accent} strokeWidth={1.75} />
                <Text style={[styles.captureText, photos.length >= MAX_PHOTOS && { color: t.textMuted }]}>Take photo</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.captureBtn}
                onPress={() => capture('library')}
                activeOpacity={0.85}
                disabled={photos.length >= MAX_PHOTOS}
                accessibilityState={{ disabled: photos.length >= MAX_PHOTOS }}
              >
                <ImagePlus size={22} color={photos.length >= MAX_PHOTOS ? t.textMuted : t.accent} strokeWidth={1.75} />
                <Text style={[styles.captureText, photos.length >= MAX_PHOTOS && { color: t.textMuted }]}>From library</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Scan CTA */}
        {photos.length > 0 && !hasReviews && (
          <TouchableOpacity style={[styles.aiBtn, busy && { opacity: 0.7 }]} onPress={detect} disabled={busy} activeOpacity={0.85} testID="xray-scan">
            {busy ? <ActivityIndicator size="small" color={Colors.textOnAccent} /> : <ScanSearch size={16} color={Colors.textOnAccent} strokeWidth={2} />}
            <Text style={styles.aiBtnText}>{busy ? 'Analyzing — this can take ~20 seconds…' : pending ? 'Retry scan' : 'Scan for hidden costs'}</Text>
          </TouchableOpacity>
        )}

        {/* Pending / offline */}
        {pending && error && (
          <View style={styles.warn}>
            <WifiOff size={15} color={t.accentHot} strokeWidth={1.75} />
            <Text style={styles.warnText}>{error}</Text>
          </View>
        )}

        {/* Error (non-pending) */}
        {!pending && error && (
          <View style={styles.warn}>
            <AlertTriangle size={15} color={t.danger} strokeWidth={1.75} />
            <Text style={styles.warnText}>{error}</Text>
          </View>
        )}

        {/* Review cards */}
        {hasReviews && (
          <View style={{ marginTop: 4 }}>
            <Text style={styles.sectionTitle}>{reviews.length} tell{reviews.length === 1 ? '' : 's'} found</Text>
            <Text style={styles.sectionSub}>Accept the ones worth carrying. Priced tells become GC-only contingency lines; every accepted tell also spawns a field-verify task.</Text>

            {reviews.map((r) => {
              const Icon = CAT_ICON[r.category];
              const band = effectiveBand(r);
              const isEditing = editingId === r.id;
              const rejected = r.status === 'rejected';
              return (
                <View key={r.id} style={[styles.tellCard, rejected && styles.tellCardRejected, r.status === 'accepted' && styles.tellCardAccepted]}>
                  {/* Source photo with bbox */}
                  <View style={styles.tellPhotoWrap}>
                    <Image source={{ uri: r.sourcePhotoUri }} style={styles.tellPhoto} resizeMode="cover" />
                    <View
                      pointerEvents="none"
                      style={[styles.bbox, {
                        left: `${Math.max(0, Math.min(1, r.tell.bbox.x)) * 100}%`,
                        top: `${Math.max(0, Math.min(1, r.tell.bbox.y)) * 100}%`,
                        width: `${Math.max(0, Math.min(1, r.tell.bbox.w)) * 100}%`,
                        height: `${Math.max(0, Math.min(1, r.tell.bbox.h)) * 100}%`,
                      }]}
                    />
                  </View>

                  <View style={styles.tellBody}>
                    <View style={styles.tellHeadRow}>
                      <Icon size={16} color={t.accent} strokeWidth={1.75} />
                      <Text style={styles.tellName} numberOfLines={2}>{r.tell.tell}</Text>
                    </View>

                    <View style={styles.chipsRow}>
                      <View style={styles.metaChip}><Text style={styles.metaChipText}>{CAT_LABEL[r.category]}</Text></View>
                      <View style={[styles.metaChip, r.tell.severity === 'high' && styles.sevHigh]}>
                        <Text style={[styles.metaChipText, r.tell.severity === 'high' && styles.sevHighText]}>{r.tell.severity === 'med' ? 'medium' : r.tell.severity} severity</Text>
                      </View>
                      <View style={styles.metaChip}><Text style={styles.metaChipText}>{Math.round(r.tell.confidence)}% sure</Text></View>
                    </View>

                    {r.route === 'price' ? (
                      <>
                        <Text style={styles.rationale}>
                          {r.tell.likelihood}% likely to need work · priced off {RATE_BASIS_LABEL[r.rateBasis]}.
                        </Text>
                        <View style={styles.bandRow}>
                          <Text style={styles.bandExpected}>{formatMoney(band.expected)}</Text>
                          <Text style={styles.bandRange}>range {formatMoney(band.low)}–{formatMoney(band.high)}</Text>
                        </View>
                        {isEditing && (
                          <View style={styles.editRow}>
                            <View style={styles.editCol}>
                              <Text style={styles.editLabel}>Qty</Text>
                              <TextInput
                                value={String(r.qty)}
                                onChangeText={v => patchReview(r.id, { qty: Number(v.replace(/[^0-9.]/g, '')) || 0 })}
                                keyboardType="decimal-pad"
                                style={styles.editField}
                              />
                            </View>
                            <View style={styles.editCol}>
                              <Text style={styles.editLabel}>$/unit</Text>
                              <TextInput
                                value={String(r.unitPrice)}
                                onChangeText={v => patchReview(r.id, { unitPrice: Number(v.replace(/[^0-9.]/g, '')) || 0 })}
                                keyboardType="decimal-pad"
                                style={styles.editField}
                              />
                            </View>
                            <View style={[styles.editCol, { alignItems: 'flex-end' }]}>
                              <Text style={styles.editLabel}>Allowance</Text>
                              <Text style={styles.editResult}>{formatMoney(band.expected)}</Text>
                            </View>
                          </View>
                        )}
                      </>
                    ) : (
                      <View style={styles.verifyRow}>
                        <ShieldAlert size={14} color={t.accentHot} strokeWidth={1.75} />
                        <Text style={styles.verifyText}>
                          {verifyOnlyReason(r.tell) === 'no-likelihood'
                            ? 'Field-verify only — no likelihood came back for this tell, so there is nothing to weight an allowance against. It becomes a task, not a line.'
                            : 'Field-verify only — confidence too low to price. It becomes a task, not a line.'}
                        </Text>
                      </View>
                    )}

                    {/* Actions */}
                    <View style={styles.actionsRow}>
                      <TouchableOpacity
                        style={[styles.actionBtn, r.status === 'accepted' && styles.actionAccepted]}
                        onPress={() => patchReview(r.id, { status: r.status === 'accepted' ? 'pending' : 'accepted' })}
                        activeOpacity={0.85}
                      >
                        <Check size={14} color={r.status === 'accepted' ? Colors.textOnAccent : t.success} strokeWidth={2} />
                        <Text style={[styles.actionText, r.status === 'accepted' && styles.actionTextOn]}>{r.status === 'accepted' ? 'Accepted' : 'Accept'}</Text>
                      </TouchableOpacity>

                      {r.route === 'price' && (
                        <TouchableOpacity
                          style={[styles.actionBtn, isEditing && styles.actionEditing]}
                          onPress={() => setEditingId(isEditing ? null : r.id)}
                          activeOpacity={0.85}
                        >
                          <Pencil size={14} color={isEditing ? t.accent : t.textSecondary} strokeWidth={1.75} />
                          <Text style={[styles.actionText, isEditing && { color: t.accent }]}>{isEditing ? 'Done' : 'Edit'}</Text>
                        </TouchableOpacity>
                      )}

                      <TouchableOpacity
                        style={[styles.actionBtn, rejected && styles.actionRejected]}
                        onPress={() => patchReview(r.id, { status: rejected ? 'pending' : 'rejected' })}
                        activeOpacity={0.85}
                      >
                        <X size={14} color={rejected ? Colors.textOnAccent : t.textSecondary} strokeWidth={2} />
                        <Text style={[styles.actionText, rejected && styles.actionTextOn]}>{rejected ? 'Rejected' : 'Reject'}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

      {/* Apply bar */}
      {hasReviews && (
        <View style={[styles.applyBar, { paddingBottom: 12 + insets.bottom }]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.applyCount}>{accepted.length} accepted</Text>
            {acceptedContingency > 0 && <Text style={styles.applySub}>{formatMoney(acceptedContingency)} contingency</Text>}
          </View>
          <TouchableOpacity
            style={[styles.applyBtn, accepted.length === 0 && styles.applyBtnDisabled]}
            onPress={applyToEstimate}
            disabled={accepted.length === 0}
            activeOpacity={0.85}
            testID="xray-apply"
          >
            <Check size={16} color={Colors.textOnAccent} strokeWidth={2} />
            <Text style={styles.applyBtnText}>Add {accepted.length} to estimate</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: t.bg },
  header: {
    flexDirection: 'row' as const, alignItems: 'center' as const,
    paddingHorizontal: 12, paddingVertical: 10, gap: 8,
    borderBottomWidth: 1, borderBottomColor: t.line,
  },
  headerBtn: { width: 38, height: 38, alignItems: 'center' as const, justifyContent: 'center' as const },
  headerText: { flex: 1 },
  headerEyebrow: { fontSize: Type.caption2.fontSize, color: t.textMuted, fontWeight: '600' as const, letterSpacing: 0.4 },
  headerTitle: { fontSize: Type.headline.fontSize, fontWeight: '700' as const, color: t.text },

  pickerWrap: { marginBottom: 14 },
  pickerLabel: { fontSize: Type.caption1.fontSize, color: t.textSecondary, fontWeight: '600' as const, marginBottom: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: Tokens.radius.full, borderWidth: 1, borderColor: t.line, backgroundColor: t.surface, maxWidth: 180 },
  chipOn: { backgroundColor: t.accent + '1A', borderColor: t.accent },
  chipText: { fontSize: Type.caption1.fontSize, color: t.textSecondary, fontWeight: '600' as const },
  chipTextOn: { color: t.accent },

  introCard: {
    flexDirection: 'row' as const, gap: 12, alignItems: 'flex-start' as const,
    backgroundColor: t.surface, borderRadius: Tokens.radius.panel, borderWidth: 1, borderColor: t.line,
    padding: 14, marginBottom: 14,
  },
  introText: { flex: 1, fontSize: Type.footnote.fontSize, color: t.textSecondary, lineHeight: 19 },
  introEmph: { fontWeight: '800' as const, color: t.text },
  tipsBox: { gap: 5, paddingTop: 2 },
  tipsLabel: { fontSize: Type.caption2.fontSize, color: t.textMuted, fontWeight: '600' as const, letterSpacing: 0.3, marginBottom: 2 },
  tipRow: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 7 },
  tipDot: { width: 4, height: 4, borderRadius: Tokens.radius.full, backgroundColor: t.accent + 'AA', marginTop: 5 },
  tipText: { flex: 1, fontSize: Type.caption1.fontSize, color: t.textSecondary, lineHeight: 17 },

  captureHeaderRow: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, marginBottom: 4 },
  photoCountBadge: { fontSize: Type.caption1.fontSize, color: t.textMuted, fontWeight: '600' as const },
  photoCountMax: { fontSize: Type.caption2.fontSize, color: t.accentHot, fontWeight: '600' as const },

  thumbsRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8, marginBottom: 12 },
  thumbWrap: { position: 'relative' as const },
  thumb: { width: 72, height: 72, borderRadius: Tokens.radius.card, backgroundColor: t.surface },
  thumbDel: {
    position: 'absolute' as const, top: -6, right: -6, width: 22, height: 22, borderRadius: Tokens.radius.full,
    backgroundColor: t.danger, alignItems: 'center' as const, justifyContent: 'center' as const,
  },

  captureRow: { flexDirection: 'row' as const, gap: 12, marginBottom: 12 },
  captureBtn: {
    flex: 1, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 8,
    backgroundColor: t.surface, borderRadius: Tokens.radius.panel, borderWidth: 1, borderColor: t.line,
    paddingVertical: 26,
  },
  captureText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: t.text },

  aiBtn: {
    flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 8,
    backgroundColor: t.accent, borderRadius: Tokens.radius.card, paddingVertical: 14, marginBottom: 8,
  },
  aiBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: Colors.textOnAccent },

  warn: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 8, backgroundColor: t.surface, borderRadius: Tokens.radius.card, borderWidth: 1, borderColor: t.line, padding: 12, marginBottom: 12, marginTop: 4 },
  warnText: { flex: 1, fontSize: Type.footnote.fontSize, color: t.textSecondary, lineHeight: 18 },

  sectionTitle: { fontSize: Type.subheadline.fontSize, fontWeight: '700' as const, color: t.text, marginBottom: 4, marginTop: 4 },
  sectionSub: { fontSize: Type.footnote.fontSize, color: t.textSecondary, lineHeight: 18, marginBottom: 14 },

  tellCard: { backgroundColor: t.surface, borderRadius: Tokens.radius.panel, borderWidth: 1, borderColor: t.line, marginBottom: 12, overflow: 'hidden' as const },
  tellCardAccepted: { borderColor: t.success },
  tellCardRejected: { opacity: 0.55 },

  tellPhotoWrap: { position: 'relative' as const, width: '100%' as const, height: 180, backgroundColor: t.bg },
  tellPhoto: { width: '100%' as const, height: '100%' as const },
  bbox: { position: 'absolute' as const, borderWidth: 2, borderColor: t.accent, borderRadius: Tokens.radius.xs, backgroundColor: t.accent + '18' },

  tellBody: { padding: 12, gap: 8 },
  tellHeadRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8 },
  tellName: { flex: 1, fontSize: Type.subhead.fontSize, fontWeight: '800' as const, color: t.text },

  chipsRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 6 },
  metaChip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: Tokens.radius.full, backgroundColor: t.bg, borderWidth: 1, borderColor: t.line },
  metaChipText: { fontSize: Type.caption2.fontSize, color: t.textSecondary, fontWeight: '600' as const },
  sevHigh: { backgroundColor: t.danger + '16', borderColor: t.danger + '55' },
  sevHighText: { color: t.danger },

  rationale: { fontSize: Type.footnote.fontSize, color: t.textSecondary, lineHeight: 18 },
  bandRow: { flexDirection: 'row' as const, alignItems: 'baseline' as const, gap: 10 },
  bandExpected: { fontSize: Type.title3.fontSize, fontWeight: '800' as const, color: t.text },
  bandRange: { fontSize: Type.caption1.fontSize, color: t.textMuted },

  editRow: { flexDirection: 'row' as const, gap: 8, alignItems: 'flex-end' as const, marginTop: 2 },
  editCol: { flex: 1 },
  editLabel: { fontSize: Type.caption2.fontSize, color: t.textMuted, marginBottom: 3 },
  editField: {
    backgroundColor: t.bg, borderRadius: Tokens.radius.xs, borderWidth: 1, borderColor: t.line,
    paddingHorizontal: 8, paddingVertical: 7, fontSize: Type.footnote.fontSize, color: t.text,
  },
  editResult: { fontSize: Type.subhead.fontSize, fontWeight: '800' as const, color: t.text, paddingVertical: 7 },

  verifyRow: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 7, backgroundColor: t.accentHot + '12', borderRadius: Tokens.radius.sm, padding: 9 },
  verifyText: { flex: 1, fontSize: Type.caption1.fontSize, color: t.textSecondary, lineHeight: 16 },

  actionsRow: { flexDirection: 'row' as const, gap: 8, marginTop: 2 },
  actionBtn: {
    flex: 1, flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 6,
    paddingVertical: 9, borderRadius: Tokens.radius.sm, borderWidth: 1, borderColor: t.line, backgroundColor: t.bg,
  },
  actionText: { fontSize: Type.caption1.fontSize, fontWeight: '700' as const, color: t.textSecondary },
  actionTextOn: { color: Colors.textOnAccent },
  actionAccepted: { backgroundColor: t.success, borderColor: t.success },
  actionRejected: { backgroundColor: t.textMuted, borderColor: t.textMuted },
  actionEditing: { borderColor: t.accent, backgroundColor: t.accent + '12' },

  applyBar: {
    position: 'absolute' as const, left: 0, right: 0, bottom: 0,
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12,
    paddingHorizontal: 16, paddingTop: 12,
    backgroundColor: t.surface, borderTopWidth: 1, borderTopColor: t.line,
  },
  applyCount: { fontSize: Type.subhead.fontSize, fontWeight: '800' as const, color: t.text },
  applySub: { fontSize: Type.caption1.fontSize, color: t.textSecondary, marginTop: 1 },
  applyBtn: {
    flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 8,
    backgroundColor: t.accent, borderRadius: Tokens.radius.card, paddingVertical: 13, paddingHorizontal: 18,
  },
  applyBtnDisabled: { opacity: 0.4 },
  applyBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: Colors.textOnAccent },
});
