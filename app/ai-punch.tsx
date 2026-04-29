// AI Punch from Photos — turns a walkthrough into a punch list in
// one tap. Three steps:
//
//   1. Pick photos (from the project gallery or via the camera roll)
//   2. AI analyzes (Gemini Vision via supabase/functions/analyze-photos)
//   3. GC reviews + saves (each suggested punch item is editable +
//      can be discarded; bulk-save commits the keepers)
//
// The screen is intentionally narrow scope: pick → analyze → review.
// No editing the photo list mid-review, no batched re-analyze. The
// GC who wants more photos drops back to step 1.

import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  Image, Alert, Platform, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { generateUUID } from '@/utils/generateId';
import {
  Camera, ImagePlus, Sparkles, X, Trash2, ChevronRight, Save, AlertCircle,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { type PunchItem, type PunchItemPriority, type SubTrade } from '@/types';
import { analyzePhotosForPunch, type AiPunchItem } from '@/utils/photoAnalyzer';
import { stampPhotoLocation, type PhotoGeoStamp } from '@/utils/photoGeoStamp';
import { sentenceCase, titleCase } from '@/utils/voiceFormParsers';

// Map the loose AI-trade string to the strict SubTrade enum used in
// the data model. Expanded per code-review #8 to cover the trades
// the AI prompt mentions but the SubTrade enum doesn't natively
// include — Cabinets, Trim/Carpentry, Doors/Hardware, Insulation,
// Cleanup all funnel to the closest enum value rather than collapsing
// to "Other" and losing the signal.
function aiTradeToSubTrade(aiTrade: string): SubTrade {
  const t = (aiTrade || '').toLowerCase();
  if (t.includes('electrical')) return 'Electrical';
  if (t.includes('plumb')) return 'Plumbing';
  if (t.includes('hvac') || t.includes('mechanical')) return 'HVAC';
  if (t.includes('drywall')) return 'Drywall';
  if (t.includes('paint')) return 'Painting';
  if (t.includes('tile') || t.includes('floor')) return 'Flooring';
  if (t.includes('roof')) return 'Roofing';
  if (t.includes('concrete') || t.includes('masonry')) return 'Concrete';
  if (t.includes('frame') || t.includes('framing')) return 'Framing';
  if (t.includes('landscap')) return 'Landscaping';
  // Trim, carpentry, cabinets, doors, hardware, insulation all
  // belong to a generalist carpenter/finishing scope in residential.
  // 'Other' is the closest the SubTrade enum has — keep the original
  // AI label visible in the location string (set in handleSaveOne).
  if (t.includes('trim') || t.includes('carpentry') || t.includes('cabinet')
      || t.includes('door') || t.includes('hardware') || t.includes('insul')
      || t.includes('cleanup') || t.includes('clean-up')) return 'Other';
  return 'General';
}

interface PickedPhoto {
  uri: string;
  // For pickedPhotos that came from the existing project gallery, we
  // already have a stable id. Camera-roll picks have no id and we
  // mint one client-side.
  id: string;
  fromProject?: boolean;
}

interface ReviewableItem extends AiPunchItem {
  /** Local id for review-list keying. */
  id: string;
  /** Mutable copy of the AI fields so the GC can edit before save. */
  editedDescription: string;
  editedLocation: string;
  editedTrade: SubTrade;
  editedPriority: PunchItemPriority;
  /** Source photo URI (resolved from photoIndex at analyze time). */
  photoUri: string;
  /** Source photo's stable id from pickedPhotos. Round-3 #3 — URI
   *  comparison was fragile (extension casing / percent encoding).
   *  Tracking by id lets handleSaveOne look up reliably. */
  sourcePhotoId: string;
  /** Set when saved — disables the Save button on this row. */
  saved?: boolean;
  /** Set when the GC discards. */
  discarded?: boolean;
}

const PRIORITY_COLORS: Record<PunchItemPriority, string> = {
  high: Colors.error,
  medium: Colors.warning,
  low: Colors.textMuted,
};

export default function AiPunchScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const { getProject, getPhotosForProject, addPunchItem } = useProjects();

  const project = useMemo(() => projectId ? getProject(projectId) : null, [projectId, getProject]);
  // Sort newest-first so the "Show recent" toggle label actually
  // matches what the gallery surfaces (round-2 #5). Bad/invalid
  // timestamps coerce to NaN which makes the sort non-deterministic
  // (round-3 #4) — Number.isFinite guard kicks them to the end.
  const projectPhotos = useMemo(() => {
    const list = projectId ? getPhotosForProject(projectId) : [];
    const safeTime = (t: string | undefined) => {
      if (!t) return 0;
      const v = new Date(t).getTime();
      return Number.isFinite(v) ? v : 0;
    };
    return [...list].sort((a, b) => safeTime(b.timestamp) - safeTime(a.timestamp));
  }, [projectId, getPhotosForProject]);

  const [pickedPhotos, setPickedPhotos] = useState<PickedPhoto[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Warning channel — used for "partial success" states (e.g. some
  // photos couldn't be read, AI ran on the rest). Red-styled `error`
  // is the wrong vibe for a partial result. Round-4 #3.
  const [notice, setNotice] = useState<string | null>(null);
  const [reviewItems, setReviewItems] = useState<ReviewableItem[]>([]);
  const [showAllGallery, setShowAllGallery] = useState(false);

  // ── Step 1: pick photos ──────────────────────────────────────
  const togglePhotoFromGallery = useCallback((id: string, uri: string) => {
    setPickedPhotos(prev => {
      const isPicked = prev.find(p => p.id === id);
      if (isPicked) return prev.filter(p => p.id !== id);
      if (prev.length >= 12) {
        Alert.alert('Max 12 photos', 'Pick the most informative shots — Gemini Vision tops out at 12 per call.');
        return prev;
      }
      return [...prev, { id, uri, fromProject: true }];
    });
  }, []);

  const handlePickFromCameraRoll = useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Photo access needed', 'Grant photo access in Settings to pick photos.');
      return;
    }
    const remaining = 12 - pickedPhotos.length;
    if (remaining <= 0) {
      Alert.alert('Max 12 photos', 'Remove a photo before adding more.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      selectionLimit: remaining,
      quality: 0.4,
    });
    if (result.canceled) return;
    const additions: PickedPhoto[] = result.assets.map((a, i) => ({
      id: `roll-${generateUUID().slice(0, 8)}-${i}`,
      uri: a.uri,
    }));
    setPickedPhotos(prev => [...prev, ...additions]);
  }, [pickedPhotos.length]);

  const handleTakePhoto = useCallback(async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Camera access needed', 'Grant camera permission in Settings.');
      return;
    }
    if (pickedPhotos.length >= 12) {
      Alert.alert('Max 12 photos', 'Remove a photo before taking more.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.7 });
    if (result.canceled || !result.assets[0]) return;
    setPickedPhotos(prev => [...prev, { id: `cam-${generateUUID()}`, uri: result.assets[0].uri }]);
  }, [pickedPhotos.length]);

  // ── Step 2: analyze ──────────────────────────────────────────
  const handleAnalyze = useCallback(async () => {
    if (pickedPhotos.length === 0) {
      Alert.alert('Pick at least one photo first');
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { items, meta } = await analyzePhotosForPunch({
        photoUrls: pickedPhotos.map(p => p.uri),
        projectName: project?.name,
        projectType: project?.type,
      });
      // Items come back with photoIndex remapped to the caller's
      // original list — so pickedPhotos[item.photoIndex] is the
      // correct source even if some photos failed to encode.
      const reviewable: ReviewableItem[] = items.map(item => {
        const sourcePhoto = pickedPhotos[Math.min(item.photoIndex, pickedPhotos.length - 1)];
        return {
          ...item,
          id: `rev-${generateUUID()}`,
          editedDescription: sentenceCase(item.description),
          editedLocation: titleCase(item.location || ''),
          editedTrade: aiTradeToSubTrade(item.trade),
          editedPriority: item.priority,
          photoUri: sourcePhoto?.uri ?? '',
          sourcePhotoId: sourcePhoto?.id ?? '',
        };
      });
      if (reviewable.length === 0) {
        setError('AI didn’t find any punch items in those photos. Try shots closer to the work, or with better lighting.');
      } else if (meta.skippedIndexes.length > 0) {
        // Partial success — some photos couldn't be read but the AI
        // analyzed the rest. Surface as a warning, not an error
        // (round-4 #3): different visual channel + amber tone.
        setNotice(
          `Skipped ${meta.skippedIndexes.length} photo${meta.skippedIndexes.length === 1 ? '' : 's'} that couldn't be read. ` +
          `Found ${reviewable.length} item${reviewable.length === 1 ? '' : 's'} from the rest.`,
        );
      }
      setReviewItems(reviewable);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      const msg = (err as Error)?.message || String(err);
      setError(msg);
    } finally {
      setBusy(false);
    }
  }, [pickedPhotos, project]);

  // ── Step 3: review + save ────────────────────────────────────
  const updateReviewItem = useCallback((id: string, updates: Partial<ReviewableItem>) => {
    setReviewItems(prev => prev.map(r => r.id === id ? { ...r, ...updates } : r));
  }, []);

  /**
   * Save one item. The optional `presetStamp` is the bulk-save's
   * single-fix GPS stamp — passed in by handleSaveAll so we don't
   * re-fix per item (round-2 #4: 10 saves × 3s GPS budget = 30s).
   * For single-item saves (the per-row Save button) the stamp is
   * captured at save time as before.
   */
  const handleSaveOne = useCallback(async (item: ReviewableItem, presetStamp?: PhotoGeoStamp | null) => {
    if (!project || item.saved) return;
    if (!item.editedDescription.trim()) {
      Alert.alert('Description required');
      return;
    }
    // For gallery photos the source already has its own stamp; the
    // GC's CURRENT location is wrong if they're reviewing yesterday's
    // photos in the office. Only stamp on camera/library picks.
    // (Round-2 #8.) Look up by stable id, not URI (round-3 #3) —
    // iOS file:// URIs sometimes mutate after the picker.
    const sourcePicked = pickedPhotos.find(p => p.id === item.sourcePhotoId);
    const shouldStamp = sourcePicked ? !sourcePicked.fromProject : true;
    let stamp: PhotoGeoStamp | null = null;
    if (shouldStamp) {
      stamp = presetStamp !== undefined ? presetStamp : await stampPhotoLocation();
    }
    const now = new Date().toISOString();
    // PunchItem doesn't have a `trade` column — trade is implicit via
    // assignedSubId. We surface the AI-inferred trade in the location
    // string ("Master Bath — Electrical") so the GC can pick the right
    // sub on the punch list screen.
    const locationWithTrade = item.editedLocation.trim()
      ? `${item.editedLocation.trim()} — ${item.editedTrade}`
      : item.editedTrade;
    const punch: PunchItem = {
      id: `pi-${generateUUID()}`,
      projectId: project.id,
      description: item.editedDescription.trim(),
      location: locationWithTrade,
      assignedSub: '',
      dueDate: '',
      priority: item.editedPriority,
      status: 'open',
      photoUri: item.photoUri || undefined,
      photoLatitude: stamp?.latitude,
      photoLongitude: stamp?.longitude,
      photoLocationAccuracyMeters: stamp?.accuracyMeters,
      photoLocationLabel: stamp?.label,
      createdAt: now,
      updatedAt: now,
    };
    addPunchItem(punch);
    updateReviewItem(item.id, { saved: true });
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [project, addPunchItem, updateReviewItem, pickedPhotos]);

  const [saving, setSaving] = useState(false);
  const handleSaveAll = useCallback(async () => {
    const pending = reviewItems.filter(r => !r.saved && !r.discarded);
    if (pending.length === 0) return;
    setSaving(true);
    let saved = 0;
    let failed = 0;
    let firstError: string | null = null;
    try {
      // Single GPS fix for the whole batch — a punch walk takes a
      // few minutes in one room of the same project, so one stamp is
      // representative. Only stamp if any pending item came from
      // camera/library (gallery picks shouldn't be re-stamped with
      // the GC's current location). (Round-2 #4 + #8.)
      const needsStamp = pending.some(p => {
        const src = pickedPhotos.find(x => x.id === p.sourcePhotoId);
        return src ? !src.fromProject : true;
      });
      const sharedStamp: PhotoGeoStamp | null = needsStamp ? await stampPhotoLocation() : null;
      for (const item of pending) {
        try {
          // eslint-disable-next-line no-await-in-loop
          await handleSaveOne(item, sharedStamp);
          saved += 1;
        } catch (err) {
          failed += 1;
          if (!firstError) firstError = String((err as Error)?.message || err);
        }
      }
    } finally {
      setSaving(false);
    }
    // Report partial success accurately (code-review #4).
    const title = failed === 0
      ? `Saved ${saved} punch item${saved === 1 ? '' : 's'}`
      : `Saved ${saved} of ${pending.length}`;
    const body = failed === 0
      ? 'They’re now in the punch list.'
      : `${failed} failed${firstError ? ` — first error: ${firstError}` : '.'}\nReview the screen for items still pending.`;
    Alert.alert(title, body, [{
      text: 'OK',
      onPress: () => failed === 0 && router.replace({ pathname: '/punch-list' as never, params: { projectId: project?.id } as never }),
    }]);
  }, [reviewItems, handleSaveOne, router, project, pickedPhotos]);

  const reviewMode = reviewItems.length > 0 || error !== null;
  const savedCount = reviewItems.filter(r => r.saved).length;
  const pendingCount = reviewItems.filter(r => !r.saved && !r.discarded).length;

  if (!project) {
    return (
      <>
        <Stack.Screen options={{ title: 'AI Punch' }} />
        <View style={styles.empty}><Text style={styles.emptyText}>No project selected.</Text></View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'AI Punch from Photos', headerLargeTitle: false }} />
      <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 130 }}>
          {/* Hero / project context */}
          <View style={styles.hero}>
            <Sparkles size={20} color={Colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.heroTitle}>AI Punch from Photos</Text>
              <Text style={styles.heroSub}>
                {reviewMode
                  ? `Review what AI found. Edit, save, or discard each item.`
                  : `Pick up to 12 photos from this project. AI will turn them into a punch list — review, edit, save.`}
              </Text>
            </View>
          </View>

          {!reviewMode && (
            <>
              {/* Photo source buttons */}
              <View style={styles.section}>
                <View style={styles.sourceRow}>
                  <TouchableOpacity style={styles.sourceBtn} onPress={handleTakePhoto} activeOpacity={0.85}>
                    <Camera size={16} color={Colors.primary} />
                    <Text style={styles.sourceBtnText}>Camera</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.sourceBtn} onPress={handlePickFromCameraRoll} activeOpacity={0.85}>
                    <ImagePlus size={16} color={Colors.primary} />
                    <Text style={styles.sourceBtnText}>Photo library</Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.sectionSub}>{pickedPhotos.length} of 12 picked</Text>
              </View>

              {/* Picked photos preview */}
              {pickedPhotos.length > 0 && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Picked photos</Text>
                  <View style={styles.thumbGrid}>
                    {pickedPhotos.map(p => (
                      <View key={p.id} style={styles.thumbWrap}>
                        <Image source={{ uri: p.uri }} style={styles.thumb} />
                        <TouchableOpacity
                          style={styles.thumbRemove}
                          onPress={() => setPickedPhotos(prev => prev.filter(x => x.id !== p.id))}
                          hitSlop={8}
                        >
                          <X size={12} color="#FFF" />
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                </View>
              )}

              {/* Project gallery selector — most recent first, paginated.
                  Long-running projects can have hundreds of photos and a
                  hard 30-cap was making old photos unreachable
                  (code-review #10). The "Show all" toggle reveals the
                  rest, sorted newest-first. */}
              {projectPhotos.length > 0 && (
                <View style={styles.section}>
                  <View style={styles.galleryHead}>
                    <Text style={styles.sectionTitle}>Or pick from project gallery</Text>
                    {projectPhotos.length > 30 && (
                      <TouchableOpacity onPress={() => setShowAllGallery(s => !s)} hitSlop={10}>
                        <Text style={styles.galleryToggle}>{showAllGallery ? 'Show recent' : `Show all ${projectPhotos.length}`}</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.galleryRow}>
                    {(showAllGallery ? projectPhotos : projectPhotos.slice(0, 30)).map(ph => {
                      const picked = pickedPhotos.find(p => p.id === ph.id);
                      return (
                        <TouchableOpacity
                          key={ph.id}
                          style={[styles.galleryThumb, picked && styles.galleryThumbPicked]}
                          onPress={() => togglePhotoFromGallery(ph.id, ph.uri)}
                          activeOpacity={0.8}
                        >
                          <Image source={{ uri: ph.uri }} style={styles.galleryImg} />
                          {picked && (
                            <View style={styles.galleryCheck}>
                              <Text style={styles.galleryCheckMark}>✓</Text>
                            </View>
                          )}
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                </View>
              )}
            </>
          )}

          {/* Error banner — red, blocking. Used for actual failures. */}
          {!!error && (
            <View style={styles.section}>
              <View style={styles.errorBanner}>
                <AlertCircle size={14} color={Colors.error} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            </View>
          )}

          {/* Notice banner — amber, informational. Used for partial-
              success states like "skipped 2 photos but found 5 items
              from the rest." Different visual channel than error so
              the user understands the AI still produced a result. */}
          {!!notice && (
            <View style={styles.section}>
              <View style={styles.noticeBanner}>
                <AlertCircle size={14} color={Colors.warning} />
                <Text style={styles.noticeText}>{notice}</Text>
              </View>
            </View>
          )}

          {/* Review items */}
          {reviewItems.length > 0 && (
            <View style={styles.section}>
              <View style={styles.reviewHead}>
                <Text style={styles.sectionTitle}>{reviewItems.length} item{reviewItems.length === 1 ? '' : 's'} found</Text>
                <Text style={styles.sectionSub}>{savedCount} saved · {pendingCount} pending</Text>
              </View>
              {reviewItems.map(item => {
                if (item.discarded) return null;
                return (
                  <View key={item.id} style={[styles.reviewCard, item.saved && styles.reviewCardSaved]}>
                    {!!item.photoUri && (
                      <Image source={{ uri: item.photoUri }} style={styles.reviewPhoto} />
                    )}
                    <View style={styles.reviewBody}>
                      <View style={styles.reviewMetaRow}>
                        <View style={[styles.confidenceDot, { backgroundColor: item.confidence >= 80 ? Colors.success : Colors.warning }]} />
                        <Text style={styles.reviewMeta}>AI confidence {item.confidence}%</Text>
                      </View>
                      <TextInput
                        style={styles.reviewInput}
                        value={item.editedDescription}
                        onChangeText={t => updateReviewItem(item.id, { editedDescription: t })}
                        placeholder="Description"
                        placeholderTextColor={Colors.textMuted}
                        multiline
                        editable={!item.saved}
                      />
                      <View style={styles.reviewRow}>
                        <TextInput
                          style={[styles.reviewInputSmall, { flex: 1 }]}
                          value={item.editedLocation}
                          onChangeText={t => updateReviewItem(item.id, { editedLocation: t })}
                          placeholder="Location"
                          placeholderTextColor={Colors.textMuted}
                          editable={!item.saved}
                        />
                      </View>
                      <View style={styles.reviewRow}>
                        <View style={[styles.priorityPill, { backgroundColor: PRIORITY_COLORS[item.editedPriority] + '22' }]}>
                          <Text style={[styles.priorityText, { color: PRIORITY_COLORS[item.editedPriority] }]}>{item.editedPriority.toUpperCase()}</Text>
                        </View>
                        <Text style={styles.tradeText}>{item.editedTrade}</Text>
                      </View>
                      <View style={styles.reviewActions}>
                        {!item.saved ? (
                          <>
                            <TouchableOpacity style={styles.discardBtn} onPress={() => updateReviewItem(item.id, { discarded: true })}>
                              <Trash2 size={14} color={Colors.error} />
                              <Text style={styles.discardBtnText}>Discard</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.saveOneBtn} onPress={() => handleSaveOne(item)} activeOpacity={0.85}>
                              <Save size={14} color="#FFF" />
                              <Text style={styles.saveOneBtnText}>Save</Text>
                            </TouchableOpacity>
                          </>
                        ) : (
                          <Text style={styles.savedFlag}>✓ Saved to punch list</Text>
                        )}
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </ScrollView>

        {/* Sticky CTA */}
        <View style={[styles.fab, { bottom: insets.bottom + 18 }]}>
          {!reviewMode ? (
            <TouchableOpacity
              style={[styles.fabPrimary, (busy || pickedPhotos.length === 0) && styles.fabPrimaryDisabled]}
              onPress={handleAnalyze}
              disabled={busy || pickedPhotos.length === 0}
              activeOpacity={0.85}
            >
              {busy ? (
                <>
                  <ActivityIndicator size="small" color="#FFF" />
                  <Text style={styles.fabPrimaryText}>AI is reading the photos…</Text>
                </>
              ) : (
                <>
                  <Sparkles size={16} color="#FFF" />
                  <Text style={styles.fabPrimaryText}>Run AI · {pickedPhotos.length} photo{pickedPhotos.length === 1 ? '' : 's'}</Text>
                  <ChevronRight size={16} color="#FFF" />
                </>
              )}
            </TouchableOpacity>
          ) : pendingCount > 0 ? (
            <TouchableOpacity
              style={[styles.fabPrimary, saving && styles.fabPrimaryDisabled]}
              onPress={handleSaveAll}
              disabled={saving}
              activeOpacity={0.85}
            >
              {saving ? (
                <>
                  <ActivityIndicator size="small" color="#FFF" />
                  <Text style={styles.fabPrimaryText}>Saving {pendingCount} item{pendingCount === 1 ? '' : 's'}…</Text>
                </>
              ) : (
                <>
                  <Save size={16} color="#FFF" />
                  <Text style={styles.fabPrimaryText}>Save all {pendingCount} item{pendingCount === 1 ? '' : 's'}</Text>
                </>
              )}
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.fabPrimary}
              onPress={() => router.replace({ pathname: '/punch-list' as never, params: { projectId: project.id } as never })}
              activeOpacity={0.85}
            >
              <Text style={styles.fabPrimaryText}>Open punch list</Text>
              <ChevronRight size={16} color="#FFF" />
            </TouchableOpacity>
          )}
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: Colors.textMuted },

  hero: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 16, marginHorizontal: 16, marginTop: 8, backgroundColor: Colors.primary + '0F', borderRadius: 14, borderWidth: 1, borderColor: Colors.primary + '30' },
  heroTitle: { fontSize: 16, fontWeight: '700' as const, color: Colors.text },
  heroSub: { fontSize: 13, color: Colors.textMuted, marginTop: 4, lineHeight: 18 },

  section: { padding: 16, paddingBottom: 8 },
  sectionTitle: { fontSize: 15, fontWeight: '700' as const, color: Colors.text, marginBottom: 8 },
  sectionSub: { fontSize: 12, color: Colors.textMuted, marginTop: 4 },

  sourceRow: { flexDirection: 'row', gap: 10 },
  sourceBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, backgroundColor: Colors.primary + '12', borderRadius: 12, borderWidth: 1, borderColor: Colors.primary + '30' },
  sourceBtnText: { fontSize: 14, fontWeight: '600' as const, color: Colors.primary },

  thumbGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  thumbWrap: { width: '23%', aspectRatio: 1, borderRadius: 10, overflow: 'hidden', position: 'relative' },
  thumb: { width: '100%', height: '100%' },
  thumbRemove: { position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center' },

  galleryHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 },
  galleryToggle: { fontSize: 13, fontWeight: '600' as const, color: Colors.primary },
  galleryRow: { gap: 6, paddingVertical: 4 },
  galleryThumb: { width: 84, height: 84, borderRadius: 10, overflow: 'hidden', borderWidth: 2, borderColor: 'transparent' },
  galleryThumbPicked: { borderColor: Colors.primary },
  galleryImg: { width: '100%', height: '100%' },
  galleryCheck: { position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: 11, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  galleryCheckMark: { color: '#FFF', fontWeight: '800' as const, fontSize: 12 },

  errorBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 12, backgroundColor: Colors.error + '12', borderRadius: 12, borderWidth: 1, borderColor: Colors.error + '40' },
  errorText: { flex: 1, fontSize: 13, color: Colors.text, lineHeight: 18 },
  // Round-4 #3: notice (warning) is amber rather than red so a
  // partial-success doesn't read as a failure.
  noticeBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 12, backgroundColor: Colors.warning + '12', borderRadius: 12, borderWidth: 1, borderColor: Colors.warning + '40' },
  noticeText: { flex: 1, fontSize: 13, color: Colors.text, lineHeight: 18 },

  reviewHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  reviewCard: { flexDirection: 'row', gap: 12, backgroundColor: Colors.surface, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: Colors.cardBorder, marginBottom: 10 },
  reviewCardSaved: { backgroundColor: Colors.success + '0A', borderColor: Colors.success + '40' },
  reviewPhoto: { width: 80, height: 80, borderRadius: 10 },
  reviewBody: { flex: 1, gap: 6 },
  reviewMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  confidenceDot: { width: 8, height: 8, borderRadius: 4 },
  reviewMeta: { fontSize: 11, color: Colors.textMuted, fontWeight: '600' as const, textTransform: 'uppercase', letterSpacing: 0.5 },
  reviewInput: { backgroundColor: Colors.background, borderRadius: 8, padding: 8, fontSize: 14, color: Colors.text, minHeight: 40, borderWidth: 1, borderColor: Colors.cardBorder },
  reviewInputSmall: { backgroundColor: Colors.background, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6, fontSize: 13, color: Colors.text, borderWidth: 1, borderColor: Colors.cardBorder },
  reviewRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  priorityPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  priorityText: { fontSize: 10, fontWeight: '800' as const, letterSpacing: 0.5 },
  tradeText: { fontSize: 12, color: Colors.textMuted, fontWeight: '600' as const },
  reviewActions: { flexDirection: 'row', gap: 6, marginTop: 4 },
  discardBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  discardBtnText: { fontSize: 12, color: Colors.error, fontWeight: '600' as const },
  saveOneBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 8, backgroundColor: Colors.primary, borderRadius: 8 },
  saveOneBtnText: { fontSize: 12, fontWeight: '700' as const, color: '#FFF' },
  savedFlag: { flex: 1, fontSize: 12, color: Colors.success, fontWeight: '600' as const, textAlign: 'right' },

  fab: { position: 'absolute', left: 16, right: 16 },
  fabPrimary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.primary, paddingVertical: 14, borderRadius: 14, shadowColor: Colors.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 5 },
  fabPrimaryDisabled: { opacity: 0.5 },
  fabPrimaryText: { color: '#FFF', fontSize: 14, fontWeight: '700' as const },
});
