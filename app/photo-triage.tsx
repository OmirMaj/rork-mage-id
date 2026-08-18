// AI Photo Triage — one-tap classifier that sorts a batch of site photos
// across punch list / RFI / DFR / progress / noise. Replaces the manual
// flow where the GC has to decide up front which screen to open before
// pulling out their phone. Workflow:
//
//   1. Pick photos (project gallery, camera roll, or fresh camera)
//   2. AI classifies (Gemini Vision via supabase/functions/analyze-photos
//      with task='triage')
//   3. Review the grouped results — bucket by classification, edit /
//      override the AI's call, discard noise
//   4. Apply: punch items + RFIs get created directly; DFR observation
//      text gets stuffed into a draft daily report the GC can finalize.
//
// Differs from app/ai-punch.tsx in that ai-punch is single-purpose
// (always punch). This screen lets the user dump everything from a
// site walk and the AI fans the photos out to the right destination.

import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, Platform, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import {
  Camera, ImagePlus, X, Trash2, ChevronLeft,
  AlertCircle, ClipboardList, MessageSquare, FileText, Image as ImageIcon, Sparkle,
} from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import EmptyState from '@/components/EmptyState';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import {
  type PunchItem, type PunchItemPriority, type SubTrade, type DailyFieldReport, type RFI,
} from '@/types';
import { triagePhotos, type AiTriageEntry, type AiTriageClass } from '@/utils/photoAnalyzer';
import { generateUUID } from '@/utils/generateId';
import { sentenceCase, titleCase } from '@/utils/voiceFormParsers';
import { checkAILimit, recordAIUsage } from '@/utils/aiRateLimiter';
import { showAILimitAlert } from '@/utils/aiLimitAlert';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { showAlert } from '@/utils/alert';

// Same trade mapping used in ai-punch.tsx — funnels the loose AI string
// to the strict SubTrade enum without losing signal.
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
  if (t.includes('trim') || t.includes('carpentry') || t.includes('cabinet')
      || t.includes('door') || t.includes('hardware') || t.includes('insul')
      || t.includes('cleanup') || t.includes('clean-up')) return 'Other';
  return 'General';
}

interface PickedPhoto { uri: string; id: string; fromProject?: boolean }

interface ReviewEntry extends AiTriageEntry {
  // Local id keyed for the review list.
  id: string;
  // The source photo.
  photoUri: string;
  // User overrides — start as a copy of the AI fields.
  editedClassification: AiTriageClass;
  editedTitle: string;
  editedLocation: string;
  // Track the dropped state so we can animate or just hide.
  discarded?: boolean;
}

const CLASS_META: Record<AiTriageClass, { label: string; icon: React.FC<{ size: number; color: string }>; helper: string }> = {
  punch:    { label: 'Punch list',  icon: ClipboardList, helper: 'Becomes a punch item' },
  rfi:      { label: 'RFI',         icon: MessageSquare, helper: 'Becomes an open RFI' },
  dfr:      { label: 'Daily report', icon: FileText,      helper: 'Goes into today\'s DFR' },
  progress: { label: 'Progress',    icon: ImageIcon,     helper: 'Saved as a progress photo' },
  noise:    { label: 'Skip',        icon: Trash2,        helper: 'Blurry / accidental — discard' },
};

function classColor(t: ThemeColors, cls: AiTriageClass): string {
  switch (cls) {
    case 'punch': return t.accent;
    case 'rfi': return t.info;
    case 'dfr': return t.accent;
    case 'progress': return t.success;
    case 'noise':
    default: return t.textMuted;
  }
}

const ORDER: AiTriageClass[] = ['punch', 'rfi', 'dfr', 'progress', 'noise'];

// Photo Triage is a Pro feature (photo_documentation) — the desktop sidebar
// and tools grid advertise it as such. Gate the whole screen client-side so
// free users hit the paywall instead of the full triage UI (the checkAILimit
// inside handleAnalyze only rate-limits, it does not block by tier).
export default function PhotoTriageScreen() {
  const router = useRouter();
  const { canAccess } = useTierAccess();
  if (!canAccess('photo_documentation')) {
    return <Paywall visible feature="Photo Triage" requiredTier="pro" onClose={() => router.back()} />;
  }
  return <PhotoTriageInner />;
}

function PhotoTriageInner() {
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const router = useRouter();
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const {
    getProject, getPhotosForProject, addPunchItems, addRFIs,
    addDailyReport, updateDailyReport, getDailyReportsForProject, settings,
  } = useProjects();
  const { tier } = useSubscription();

  const project = useMemo(() => projectId ? getProject(projectId) : null, [projectId, getProject]);
  const projectPhotos = useMemo(() => projectId ? getPhotosForProject(projectId) : [], [projectId, getPhotosForProject]);

  const [pickedPhotos, setPickedPhotos] = useState<PickedPhoto[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviewEntries, setReviewEntries] = useState<ReviewEntry[]>([]);
  const [applying, setApplying] = useState(false);
  // Idempotency guard: once records are created we flip this so a double-tap,
  // a dismissed success alert, or a manual re-tap can't re-insert every punch
  // item / RFI / a second draft DFR for the same batch.
  const [applied, setApplied] = useState(false);

  // ── Photo picking ──────────────────────────────────────────────
  const togglePhotoFromGallery = useCallback((id: string, uri: string) => {
    setPickedPhotos(prev => {
      const isPicked = prev.find(p => p.id === id);
      if (isPicked) return prev.filter(p => p.id !== id);
      if (prev.length >= 12) {
        showAlert('Max 12 photos', 'Pick the most informative shots — vision analysis tops out at 12 photos per call.');
        return prev;
      }
      return [...prev, { id, uri, fromProject: true }];
    });
  }, []);

  const handlePickFromCameraRoll = useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      showAlert('Photo access needed', 'Grant photo access in Settings.');
      return;
    }
    const remaining = 12 - pickedPhotos.length;
    if (remaining <= 0) { showAlert('Max 12 photos'); return; }
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
    if (!perm.granted) { showAlert('Camera access needed'); return; }
    if (pickedPhotos.length >= 12) { showAlert('Max 12 photos'); return; }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.7 });
    if (result.canceled || !result.assets[0]) return;
    setPickedPhotos(prev => [...prev, { id: `cam-${generateUUID()}`, uri: result.assets[0].uri }]);
  }, [pickedPhotos.length]);

  // ── Run triage ─────────────────────────────────────────────────
  const handleAnalyze = useCallback(async () => {
    if (pickedPhotos.length === 0) { showAlert('Pick at least one photo first'); return; }
    const limit = await checkAILimit(tier, 'smart', 'photoAnalysis');
    if (!limit.allowed) {
      showAILimitAlert({ limit, router, monthly: true });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { entries } = await triagePhotos({
        photoUrls: pickedPhotos.map(p => p.uri),
        projectName: project?.name,
        projectType: project?.type,
      });
      await recordAIUsage('smart', 'photoAnalysis');
      const reviewable: ReviewEntry[] = entries.map(e => ({
        ...e,
        id: `rev-${generateUUID()}`,
        photoUri: pickedPhotos[Math.min(e.photoIndex, pickedPhotos.length - 1)]?.uri ?? '',
        editedClassification: e.classification,
        editedTitle: sentenceCase(e.title),
        editedLocation: titleCase(e.location || ''),
      }));
      if (reviewable.length === 0) {
        setError("AI couldn't classify those photos. Try shots closer to the work or with better lighting.");
      }
      setReviewEntries(reviewable);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      setError(`Analysis failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [pickedPhotos, project, tier]);

  // ── Apply: route each kept entry to its destination ────────────
  const grouped = useMemo(() => {
    const out: Record<AiTriageClass, ReviewEntry[]> = { punch: [], rfi: [], dfr: [], progress: [], noise: [] };
    for (const e of reviewEntries) {
      if (e.discarded) continue;
      out[e.editedClassification].push(e);
    }
    return out;
  }, [reviewEntries]);

  const handleApply = useCallback(async () => {
    if (!project) { showAlert('No project selected'); return; }
    if (applying || applied) return;
    setApplying(true);

    let punchAdded = 0;
    let rfiAdded = 0;
    let dfrAdded = 0;

    try {
      // Punch items — direct insert, status=open by default. The trade
      // is captured via assignedSub free-text (the model has no enum
      // for trade on the punch item itself); assignedSubId stays empty
      // until the GC routes it to a specific sub. Build the whole array
      // and insert in ONE batch call — the single-add path read the
      // punch list from a stale render closure per iteration, so only
      // the last item survived locally.
      const punchItems: PunchItem[] = grouped.punch.map(e => {
        const tradeLabel = aiTradeToSubTrade(e.trade);
        const now = new Date().toISOString();
        return {
          id: generateUUID(),
          projectId: project.id,
          description: e.editedTitle || e.title,
          location: e.editedLocation || e.location || '',
          assignedSub: tradeLabel === 'General' || tradeLabel === 'Other' ? '' : tradeLabel,
          dueDate: '',
          priority: ((['low', 'medium', 'high'].includes(e.priority) ? e.priority : 'medium') as PunchItemPriority),
          status: 'open',
          photoUri: e.photoUri || undefined,
          createdAt: now,
          updatedAt: now,
        };
      });
      addPunchItems(punchItems);
      punchAdded = punchItems.length;

      // RFIs — open status, blank assignedTo (the GC fills this when sending).
      // Build the whole array and insert in ONE batch call. We do NOT compute
      // `number` here: addRFIs assigns SEQUENTIAL per-project numbers off an
      // advancing counter (the single-add path recomputed from a stale closure,
      // so every RFI collided on the same number and only the last survived).
      // `number` below is a placeholder the batch overrides.
      const today = new Date().toISOString().slice(0, 10);
      const oneWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const rfis: RFI[] = grouped.rfi.map(e => {
        const now = new Date().toISOString();
        return {
          id: generateUUID(),
          number: 0,
          projectId: project.id,
          subject: e.editedTitle || e.title,
          question: e.rationale || e.title,
          submittedBy: settings?.branding?.contactName || settings?.branding?.companyName || 'Project Team',
          assignedTo: '',
          dateSubmitted: today,
          dateRequired: oneWeek,
          status: 'open',
          priority: e.priority === 'high' ? 'urgent' : e.priority === 'low' ? 'low' : 'normal',
          attachments: e.photoUri ? [e.photoUri] : [],
          createdAt: now,
          updatedAt: now,
        };
      });
      addRFIs(rfis);
      rfiAdded = rfis.length;

      // DFR — collapse all DFR-classified entries into a single draft
      // daily report for today. workPerformed gets the bulleted list
      // of observations; photos array gets stamped with each source
      // photo. The GC opens the draft, fills in weather + manpower,
      // and ships it.
      if (grouped.dfr.length > 0) {
        const workLines = grouped.dfr.map(e => `• ${e.editedTitle || e.title}${e.editedLocation ? ` (${e.editedLocation})` : ''}`);
        const dfrPhotos = grouped.dfr
          .filter(e => !!e.photoUri)
          .map(e => ({
            id: generateUUID(),
            uri: e.photoUri,
            timestamp: new Date().toISOString(),
          }));
        // Merge into today's existing DRAFT report if there is one, rather than
        // always stamping out a fresh DFR — otherwise triaging twice in a day
        // (or a double-tap) leaves multiple draft reports for the same date.
        const existingDraft = getDailyReportsForProject(project.id)
          .find(dr => dr.date === today && dr.status === 'draft');
        if (existingDraft) {
          updateDailyReport(existingDraft.id, {
            workPerformed: [existingDraft.workPerformed, workLines.join('\n')]
              .filter(s => s && s.trim().length > 0).join('\n'),
            photos: [...existingDraft.photos, ...dfrPhotos],
            updatedAt: new Date().toISOString(),
          });
        } else {
          const dfr: DailyFieldReport = {
            id: generateUUID(),
            projectId: project.id,
            date: today,
            weather: { temperature: '', conditions: '', wind: '', isManual: false },
            manpower: [],
            workPerformed: workLines.join('\n'),
            materialsDelivered: [],
            issuesAndDelays: '',
            photos: dfrPhotos,
            status: 'draft',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          addDailyReport(dfr);
        }
        dfrAdded = grouped.dfr.length;
      }

      // Records are created — lock the batch so a second Apply can't duplicate.
      setApplied(true);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const summary = [
        punchAdded > 0 ? `${punchAdded} punch item${punchAdded === 1 ? '' : 's'}` : null,
        rfiAdded > 0 ? `${rfiAdded} RFI${rfiAdded === 1 ? '' : 's'}` : null,
        dfrAdded > 0 ? `${dfrAdded} DFR observation${dfrAdded === 1 ? '' : 's'}` : null,
      ].filter(Boolean).join(', ');
      showAlert(
        'Triage applied',
        summary
          ? `${summary}. Review them on the project screen.`
          : 'Nothing to apply — every entry was classified as progress or noise.',
        [{ text: 'OK', onPress: () => router.back() }],
      );
    } catch (err) {
      showAlert('Apply failed', (err as Error).message ?? 'Could not save records.');
    } finally {
      setApplying(false);
    }
  }, [
    project, grouped, addPunchItems, addRFIs, addDailyReport, updateDailyReport,
    getDailyReportsForProject, settings, router, applying, applied,
  ]);

  // ── Per-entry mutations ────────────────────────────────────────
  const setEntryClass = (id: string, cls: AiTriageClass) => {
    setReviewEntries(prev => prev.map(e => e.id === id ? { ...e, editedClassification: cls } : e));
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  };
  const discardEntry = (id: string) => {
    setReviewEntries(prev => prev.map(e => e.id === id ? { ...e, discarded: true } : e));
  };

  // ── Render ─────────────────────────────────────────────────────
  if (!project) {
    return (
      <View style={{ flex: 1, backgroundColor: themeColors.bg }}>
        <Stack.Screen options={{ title: 'Photo Triage' }} />
        <EmptyState
          icon={<Camera size={36} color={themeColors.accent} strokeWidth={1.6} />}
          title="No project to triage yet"
          message="Photo Triage uploads field photos to a project so AI can flag punch items, RFIs, or progress shots. To run a batch:"
          steps={[
            'Open or create a project from the Projects tab.',
            'Tap Photo Triage inside the project tile grid.',
            'Pick photos or take new ones — AI will sort them into actionable buckets.',
          ]}
          actionLabel="Open Projects"
          onAction={() => router.push('/(tabs)/(home)' as any)}
        />
      </View>
    );
  }

  const reviewMode = reviewEntries.length > 0;
  const totalKept = reviewEntries.filter(e => !e.discarded).length;

  return (
    <>
      <Stack.Screen
        options={{
          title: 'AI Photo Triage',
          headerLeft: () => (
            <TouchableOpacity onPress={() => router.back()} style={{ marginLeft: 4 }}>
              <ChevronLeft size={24} color={themeColors.accent} strokeWidth={1.75} />
            </TouchableOpacity>
          ),
        }}
      />
      <ScrollView {...fabScroll} style={[styles.container, { backgroundColor: themeColors.bg }]} contentContainerStyle={{ paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }}>
        {!reviewMode && (
          <>
            <View style={styles.hero}>
              <View style={styles.heroIconWrap}>
                <MageAIMark size={20} color={themeColors.accent} />
              </View>
              <Text style={styles.heroTitle}>One walk, every record</Text>
              <Text style={styles.heroBody}>
                Snap photos as you walk the site. AI sorts them across punch list, RFI, daily report, progress shots, and noise — you review and approve. Up to 12 photos per batch.
              </Text>
            </View>

            {/* Picker actions */}
            <View style={styles.actionRow}>
              <TouchableOpacity onPress={handleTakePhoto} style={styles.actionBtn} activeOpacity={0.85}>
                <Camera size={16} color={themeColors.text} strokeWidth={1.75} />
                <Text style={styles.actionBtnText}>Camera</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handlePickFromCameraRoll} style={styles.actionBtn} activeOpacity={0.85}>
                <ImagePlus size={16} color={themeColors.text} strokeWidth={1.75} />
                <Text style={styles.actionBtnText}>Library</Text>
              </TouchableOpacity>
            </View>

            {/* Project gallery */}
            {projectPhotos.length > 0 && (
              <View style={styles.gallerySection}>
                <Text style={styles.sectionTitle}>From this project ({projectPhotos.length})</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.galleryScroll}>
                  {projectPhotos.slice(0, 30).map(p => {
                    const picked = pickedPhotos.find(pp => pp.id === p.id);
                    return (
                      <TouchableOpacity
                        key={p.id}
                        onPress={() => togglePhotoFromGallery(p.id, p.uri)}
                        style={[styles.galleryThumb, picked && styles.galleryThumbActive]}
                        activeOpacity={0.85}
                      >
                        <Image source={{ uri: p.uri }} style={styles.galleryImage} />
                        {picked && (
                          <View style={styles.galleryCheck}>
                            <Sparkle size={12} color="#FFF" strokeWidth={1.75} />
                          </View>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            )}

            {/* Picked-photos preview */}
            {pickedPhotos.length > 0 && (
              <View style={styles.pickedSection}>
                <Text style={styles.sectionTitle}>Picked ({pickedPhotos.length} of 12)</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.galleryScroll}>
                  {pickedPhotos.map(p => (
                    <View key={p.id} style={styles.pickedThumb}>
                      <Image source={{ uri: p.uri }} style={styles.galleryImage} />
                      <TouchableOpacity
                        onPress={() => setPickedPhotos(prev => prev.filter(x => x.id !== p.id))}
                        style={styles.removeChip}
                      >
                        <X size={12} color="#FFF" strokeWidth={1.75} />
                      </TouchableOpacity>
                    </View>
                  ))}
                </ScrollView>
              </View>
            )}

            {/* Analyze CTA */}
            <TouchableOpacity
              onPress={handleAnalyze}
              disabled={busy || pickedPhotos.length === 0}
              activeOpacity={0.85}
              style={[styles.analyzeBtn, (busy || pickedPhotos.length === 0) && { opacity: 0.6 }]}
            >
              {busy
                ? (
                  <>
                    <ActivityIndicator color="#FFF" />
                    <Text style={styles.analyzeText}>
                      Reading {pickedPhotos.length} photo{pickedPhotos.length === 1 ? '' : 's'}…
                    </Text>
                  </>
                )
                : (
                  <>
                    <MageAIMark size={16} color="#FFF" />
                    <Text style={styles.analyzeText}>Run AI triage</Text>
                  </>
                )}
            </TouchableOpacity>

            {error && (
              <View style={styles.errorBanner}>
                <AlertCircle size={14} color={themeColors.danger} strokeWidth={1.75} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}
          </>
        )}

        {reviewMode && (
          <>
            <View style={styles.hero}>
              <Text style={styles.heroTitle}>{totalKept} photo{totalKept === 1 ? '' : 's'} ready to apply</Text>
              <Text style={styles.heroBody}>
                Tap a chip to override the AI's call. Trash icon discards. When you're ready, hit Apply and we'll create the records.
              </Text>
            </View>

            {ORDER.map(cls => {
              const list = grouped[cls];
              if (list.length === 0) return null;
              const meta = CLASS_META[cls];
              const Icon = meta.icon;
              const color = classColor(themeColors, cls);
              return (
                <View key={cls} style={styles.bucket}>
                  <View style={styles.bucketHeader}>
                    <View style={[styles.bucketBadge, { backgroundColor: color }]}>
                      <Icon size={12} color="#FFF" />
                      <Text style={styles.bucketBadgeText}>{meta.label}</Text>
                    </View>
                    <Text style={styles.bucketCount}>{list.length}</Text>
                  </View>
                  <Text style={styles.bucketHelper}>{meta.helper}</Text>

                  {list.map(e => (
                    <View key={e.id} style={styles.entryCard}>
                      {e.photoUri ? (
                        <Image source={{ uri: e.photoUri }} style={styles.entryThumb} />
                      ) : (
                        <View style={[styles.entryThumb, { backgroundColor: themeColors.surfaceAlt }]} />
                      )}
                      <View style={{ flex: 1 }}>
                        <Text style={styles.entryTitle}>{e.editedTitle || e.title}</Text>
                        {e.editedLocation ? <Text style={styles.entryMeta}>{e.editedLocation}</Text> : null}
                        {e.rationale ? <Text style={styles.entryRationale}>{e.rationale}</Text> : null}
                        <View style={styles.classChips}>
                          {ORDER.map(c => {
                            const cColor = classColor(themeColors, c);
                            return (
                              <TouchableOpacity
                                key={c}
                                onPress={() => setEntryClass(e.id, c)}
                                style={[
                                  styles.classChip,
                                  e.editedClassification === c && {
                                    backgroundColor: cColor,
                                    borderColor: cColor,
                                  },
                                ]}
                                activeOpacity={0.7}
                              >
                                <Text style={[
                                  styles.classChipText,
                                  e.editedClassification === c && { color: '#FFF' },
                                ]}>
                                  {CLASS_META[c].label}
                                </Text>
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      </View>
                      <TouchableOpacity onPress={() => discardEntry(e.id)} style={styles.discardBtn}>
                        <Trash2 size={14} color={themeColors.textMuted} strokeWidth={1.75} />
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              );
            })}

            <TouchableOpacity
              onPress={handleApply}
              disabled={applying || applied || totalKept === 0}
              activeOpacity={0.85}
              style={[styles.applyBtn, (applying || applied || totalKept === 0) && { opacity: 0.6 }]}
            >
              {applying
                ? <ActivityIndicator color="#FFF" />
                : <Text style={styles.applyText}>{applied ? 'Applied' : 'Apply triage'}</Text>}
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  loadingContainer: { flex: 1, alignItems: 'center' as const, justifyContent: 'center' as const },
  loadingText: { fontSize: Type.body.fontSize, color: t.textMuted },

  hero: {
    margin: 16, padding: 18, borderRadius: Tokens.radius.panel,
    backgroundColor: t.accentSoft,
    borderWidth: 1, borderColor: t.accent + '33',
  },
  heroIconWrap: {
    width: 38, height: 38, borderRadius: 11,
    backgroundColor: t.accentSoft,
    alignItems: 'center' as const, justifyContent: 'center' as const,
    marginBottom: 12,
  },
  heroTitle: { fontSize: Type.title2.fontSize, fontWeight: '800' as const, color: t.text, marginBottom: 8 },
  heroBody: { fontSize: Type.footnote.fontSize, color: t.text, lineHeight: 19 },

  actionRow: { flexDirection: 'row' as const, gap: 10, marginHorizontal: 16, marginBottom: 16 },
  actionBtn: {
    flex: 1, flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 6,
    paddingVertical: 12, borderRadius: Tokens.radius.md,
    backgroundColor: t.surface, borderWidth: 1, borderColor: t.line,
  },
  actionBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: t.text },

  gallerySection: { marginHorizontal: 16, marginBottom: 16 },
  pickedSection: { marginHorizontal: 16, marginBottom: 16 },
  sectionTitle: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: t.text, marginBottom: 8 },
  galleryScroll: { gap: 8, paddingVertical: 4 },
  galleryThumb: {
    width: 84, height: 84, borderRadius: Tokens.radius.md,
    overflow: 'hidden' as const, borderWidth: 2, borderColor: 'transparent',
  },
  galleryThumbActive: { borderColor: t.accent },
  galleryImage: { width: '100%' as const, height: '100%' as const },
  galleryCheck: {
    position: 'absolute' as const, top: 4, right: 4,
    width: 18, height: 18, borderRadius: 9,
    backgroundColor: t.accent,
    alignItems: 'center' as const, justifyContent: 'center' as const,
  },
  pickedThumb: { width: 84, height: 84, borderRadius: Tokens.radius.md, overflow: 'hidden' as const },
  removeChip: {
    position: 'absolute' as const, top: 4, right: 4,
    width: 18, height: 18, borderRadius: 9,
    backgroundColor: '#0009',
    alignItems: 'center' as const, justifyContent: 'center' as const,
  },

  analyzeBtn: {
    marginHorizontal: 16, paddingVertical: 14, borderRadius: Tokens.radius.md,
    backgroundColor: t.accent,
    flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 8,
  },
  analyzeText: { color: '#FFF', fontSize: Type.body.fontSize, fontWeight: '700' as const },

  errorBanner: {
    marginHorizontal: 16, marginTop: 12,
    paddingHorizontal: 12, paddingVertical: 10, borderRadius: Tokens.radius.md,
    backgroundColor: t.danger + '1F',
    borderWidth: 1, borderColor: t.danger + '33',
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8,
  },
  errorText: { fontSize: Type.caption1.fontSize, color: t.danger, flex: 1, lineHeight: 17 },

  bucket: { marginHorizontal: 16, marginBottom: 18 },
  bucketHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, marginBottom: 4 },
  bucketBadge: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999,
  },
  bucketBadgeText: { color: '#FFF', fontSize: Type.caption2.fontSize, fontWeight: '800' as const, letterSpacing: 0.4 },
  bucketCount: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: t.text },
  bucketHelper: { fontSize: Type.caption1.fontSize, color: t.textMuted, marginBottom: 8 },

  entryCard: {
    flexDirection: 'row' as const, gap: 12,
    backgroundColor: t.surface, borderRadius: Tokens.radius.card,
    borderWidth: 1, borderColor: t.line,
    padding: 12, marginBottom: 8,
  },
  entryThumb: { width: 64, height: 64, borderRadius: Tokens.radius.md },
  entryTitle: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: t.text },
  entryMeta: { fontSize: Type.caption1.fontSize, color: t.textMuted, marginTop: 2 },
  entryRationale: { fontSize: Type.caption1.fontSize, color: t.textMuted, marginTop: 4, fontStyle: 'italic' as const },

  classChips: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 6, marginTop: 8 },
  classChip: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999,
    backgroundColor: t.surfaceAlt,
    borderWidth: 1, borderColor: t.line,
  },
  classChipText: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const, color: t.text },

  discardBtn: { padding: 6 },

  applyBtn: {
    marginHorizontal: 16, marginTop: 8, paddingVertical: 14, borderRadius: Tokens.radius.md,
    backgroundColor: t.text,
    alignItems: 'center' as const, justifyContent: 'center' as const,
  },
  applyText: { color: '#FFF', fontSize: Type.body.fontSize, fontWeight: '700' as const },
});
