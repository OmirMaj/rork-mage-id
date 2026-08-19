// plan-intelligence.tsx — Togal-style AI plan estimating, MAGE-flavored.
//
// Flow: pick a project → pick a plan sheet (saved sheets from the visual
// takeoff flow, or any image from the library) → AI detects every room
// (name, type, sqft, where it sits on the sheet) → the GC taps rooms to fix
// square footage, set their $/SF, and leave notes → one tap adds the whole
// room-by-room breakdown to the project estimate.
//
// The differentiator vs. Togal/STACK/PlanSwift: every correction TRAINS the
// per-room-type memory (utils/planIntelligence + hooks/usePlanRooms). Next
// plan arrives pre-corrected and priced at the GC's own learned rates, with
// their recurring notes carried forward — over time the GC reviews instead
// of measures. Desktop takeoff tools are $1,700–5,000/yr/seat and learn
// nothing; this is on the phone and gets smarter every job.
//
// Vision call: utils/photoAnalyzer.analyzePlanRooms → analyze-photos edge fn
// 'rooms' task (Pro-gated server-side, counts under the existing vision cap).

import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Image, Modal, Platform, KeyboardAvoidingView, Switch,
  type LayoutChangeEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, useBrainFabLift } from '@/components/brain/brainFabState';
import { useLocalSearchParams, Stack, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft, ScanSearch, FileImage, X, Check,
  StickyNote, Plus, RefreshCw, GraduationCap,
} from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import ConstructionLoader from '@/components/ConstructionLoader';
import EmptyState from '@/components/EmptyState';
import { usePlanRooms } from '@/hooks/usePlanRooms';
import { analyzePlanRooms } from '@/utils/photoAnalyzer';
import {
  buildPlanRooms, learnFromSession, roomsToEstimateLines, planRoomTotals,
  memorySummary, ROOM_TYPE_LABELS, type PlanRoom,
} from '@/utils/planIntelligence';
import { commitEstimatePatch } from '@/utils/estimateCommit';
import { generateUUID } from '@/utils/generateId';
import { formatMoney } from '@/utils/formatters';
import type { LinkedEstimate, LinkedEstimateItem } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import AskPlansPanel from '@/components/plans/AskPlansPanel';
import { showAlert } from '@/utils/alert';

export default function PlanIntelligenceScreen() {
  const router = useRouter();
  const { canAccess } = useTierAccess();
  if (!canAccess('ai_estimate_wizard')) {
    return (
      <Paywall
        visible={true}
        feature="Plan Intelligence"
        requiredTier="pro"
        onClose={() => router.back()}
      />
    );
  }
  return <PlanIntelligenceInner />;
}

type Phase = 'pick' | 'analyzing' | 'review';

function PlanIntelligenceInner() {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  // The sticky bar below is position:absolute, so bottom padding cannot clear
  // it — measure it and lift the FAB by its height instead.
  const [bottomBarH, setBottomBarH] = useState(0);
  const onBottomBarLayout = useCallback((e: LayoutChangeEvent) => {
    setBottomBarH(e.nativeEvent.layout.height);
  }, []);
  const router = useRouter();
  const { projectId: paramProjectId } = useLocalSearchParams<{ projectId?: string }>();
  const { projects, getProject, getPlanSheetsForProject, updateProject } = useProjects();
  const { memory, setMemory, saveSession, getSession } = usePlanRooms();

  const [projectId, setProjectId] = useState<string | null>(paramProjectId ?? null);
  const project = useMemo(() => (projectId ? getProject(projectId) : null), [projectId, getProject]);
  const planSheets = useMemo(
    () => (projectId ? getPlanSheetsForProject(projectId) : []),
    [projectId, getPlanSheetsForProject],
  );

  const [phase, setPhase] = useState<Phase>('pick');
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [imageAspect, setImageAspect] = useState(1.4);
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [rooms, setRooms] = useState<PlanRoom[]>([]);
  useBrainFabLift(phase === 'review' && rooms.length > 0 ? bottomBarH : 0);
  const [editing, setEditing] = useState<PlanRoom | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [taught, setTaught] = useState(false);
  const [addedNote, setAddedNote] = useState<string | null>(null);

  const trainedLine = memorySummary(memory);
  const totals = useMemo(() => planRoomTotals(rooms), [rooms]);
  // Included rooms still priced off DEFAULT_ROOM_RATES rather than a rate the
  // GC taught or typed. The footer total is only as real as this count is low.
  const placeholderRoomCount = useMemo(
    () => rooms.filter(r => r.included && r.rateSource === 'default').length,
    [rooms],
  );

  const measureAspect = useCallback((uri: string, w?: number, h?: number) => {
    if (w && h && w > 0 && h > 0) { setImageAspect(w / h); return; }
    Image.getSize(uri, (iw, ih) => { if (iw > 0 && ih > 0) setImageAspect(iw / ih); }, () => {});
  }, []);

  // Restore the last confirmed session for this project, if any.
  const session = projectId ? getSession(projectId) : null;
  const restoreSession = useCallback(() => {
    if (!session) return;
    setRooms(session.rooms);
    setSheetId(session.planSheetId ?? null);
    if (session.imageUri) {
      setImageUri(session.imageUri);
      measureAspect(session.imageUri);
    }
    setPhase('review');
  }, [session, measureAspect]);

  const runAnalysis = useCallback(async (uri: string, fromSheetId: string | null, w?: number, h?: number) => {
    setError(null);
    setTaught(false);
    setAddedNote(null);
    setImageUri(uri);
    setSheetId(fromSheetId);
    measureAspect(uri, w, h);
    setPhase('analyzing');
    try {
      const { rooms: raw } = await analyzePlanRooms({
        photoUrls: [uri],
        projectName: project?.name,
        projectType: project?.type,
      });
      const built = buildPlanRooms(raw, memory, generateUUID);
      if (built.length === 0) {
        setError("No rooms detected — make sure the image is a floor plan (not an elevation or detail sheet), then try again.");
        setPhase('pick');
        return;
      }
      setRooms(built);
      setPhase('review');
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Analysis failed. Try again.');
      setPhase('pick');
    }
  }, [project, memory, measureAspect]);

  const pickFromLibrary = useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { showAlert('Permission needed', 'Allow photo library access to pick a plan image.'); return; }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 });
    if (res.canceled || !res.assets?.[0]?.uri) return;
    const a = res.assets[0];
    void runAnalysis(a.uri, null, a.width, a.height);
  }, [runAnalysis]);

  const updateRoom = useCallback((id: string, patch: Partial<PlanRoom>) => {
    setRooms(prev => prev.map(r => (r.id === id ? { ...r, ...patch } : r)));
    setTaught(false);
  }, []);

  // ── teach the memory (the learning step) ────────────────────────────
  const handleTeach = useCallback(() => {
    if (!projectId || rooms.length === 0) return;
    setMemory(learnFromSession(rooms, memory));
    saveSession({
      projectId,
      planSheetId: sheetId ?? undefined,
      imageUri: imageUri ?? undefined,
      rooms,
      updatedAt: new Date().toISOString(),
    });
    setTaught(true);
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [projectId, rooms, memory, setMemory, saveSession, sheetId, imageUri]);

  // ── add to estimate (same patch flow as visual takeoff) ─────────────
  const handleAddToEstimate = useCallback(() => {
    if (!project?.linkedEstimate) return;
    const lines = roomsToEstimateLines(rooms);
    if (lines.length === 0) return;
    const est = project.linkedEstimate;
    const items: LinkedEstimateItem[] = lines.map(l => ({
      materialId: generateUUID(),
      name: l.name,
      category: l.category,
      unit: l.unit,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      bulkPrice: l.unitPrice,
      markup: 0,
      usesBulk: false,
      lineTotal: l.lineTotal,
      supplier: '',
    }));
    const addedBase = items.reduce((s, i) => s + i.lineTotal, 0);
    // Preserve the estimate's existing effective markup ratio, same as the
    // visual-takeoff add flow — don't recompute markup policy from scratch.
    const ratio = est.baseTotal > 0 ? est.markupTotal / est.baseTotal : 0;
    const addedMarkup = addedBase * ratio;
    const next: LinkedEstimate = {
      ...est,
      items: [...est.items, ...items],
      baseTotal: est.baseTotal + addedBase,
      markupTotal: est.markupTotal + addedMarkup,
      grandTotal: est.grandTotal + addedBase + addedMarkup,
    };
    updateProject(project.id, commitEstimatePatch(project, next, { reason: 'manual', note: 'Added from Plan Intelligence' }));
    handleTeach();
    setAddedNote(`${items.length} room line${items.length === 1 ? '' : 's'} · ${formatMoney(addedBase)} added to the estimate`);
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [project, rooms, updateProject, handleTeach]);

  // ── render ───────────────────────────────────────────────────────────
  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
          <ChevronLeft size={22} color={t.text} strokeWidth={1.75} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.headerEyebrow}>Plan Intelligence · MAGE ID</Text>
          <Text style={styles.headerTitle} numberOfLines={1}>{project?.name ?? 'AI plan estimator'}</Text>
        </View>
        {phase === 'review' ? (
          <TouchableOpacity onPress={() => setPhase('pick')} style={styles.headerBtn} hitSlop={8} accessibilityRole="button" accessibilityLabel="New analysis">
            <RefreshCw size={18} color={t.textSecondary} strokeWidth={1.75} />
          </TouchableOpacity>
        ) : (
          <View style={styles.headerBtn} />
        )}
      </View>

      {phase === 'analyzing' ? (
        <ConstructionLoader
          size="lg"
          style={{ flex: 1 }}
          labels={[
            'Reading the plan…',
            'Finding every room…',
            'Measuring square footage…',
            trainedLine ? 'Applying what you taught me…' : 'Pricing each room…',
            'Almost there…',
          ]}
        />
      ) : (
        <ScrollView {...fabScroll} contentContainerStyle={{ padding: 16, paddingBottom: 120 + insets.bottom }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {/* Memory status — the trust-builder. */}
          <View style={styles.memoryChip}>
            <GraduationCap size={14} color={trainedLine ? t.accent : t.textMuted} strokeWidth={1.75} />
            <Text style={[styles.memoryChipText, trainedLine ? { color: t.text } : null]}>
              {trainedLine ?? 'Untrained — corrections you make here teach the AI for next time'}
            </Text>
          </View>

          {/* Ask Your Plans — shown whenever a project is loaded (all phases). */}
          {project && (
            <AskPlansPanel projectId={project.id} sheets={planSheets} />
          )}

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          {phase === 'pick' && (
            <>
              {!project ? (
                projects.length === 0 ? (
                  <EmptyState
                    icon={<ScanSearch size={36} color={t.accent} strokeWidth={1.6} />}
                    title="No projects yet"
                    message="Plan Intelligence reads a floor plan and builds a room-by-room estimate. Create a project first so the rooms have somewhere to land."
                    actionLabel="Open Projects"
                    onAction={() => router.push('/(tabs)/(home)' as never)}
                  />
                ) : (
                  <>
                    <Text style={styles.sectionTitle}>Pick a project</Text>
                    {projects.map(p => (
                      <TouchableOpacity key={p.id} style={styles.pickRow} onPress={() => setProjectId(p.id)} activeOpacity={0.8}>
                        <Text style={styles.pickRowTitle} numberOfLines={1}>{p.name}</Text>
                        <Plus size={16} color={t.accent} strokeWidth={1.75} />
                      </TouchableOpacity>
                    ))}
                  </>
                )
              ) : (
                <>
                  {session && (
                    <TouchableOpacity style={styles.resumeCard} onPress={restoreSession} activeOpacity={0.85}>
                      <MageAIMark size={16} color={t.accent} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.resumeTitle}>Resume last session</Text>
                        <Text style={styles.resumeSub}>{session.rooms.length} rooms · saved {new Date(session.updatedAt).toLocaleDateString()}</Text>
                      </View>
                    </TouchableOpacity>
                  )}

                  <Text style={styles.sectionTitle}>Pick a plan sheet</Text>
                  {planSheets.map(s => (
                    <TouchableOpacity key={s.id} style={styles.pickRow} onPress={() => void runAnalysis(s.imageUri, s.id, s.width, s.height)} activeOpacity={0.8}>
                      <FileImage size={16} color={t.textSecondary} strokeWidth={1.75} />
                      <Text style={styles.pickRowTitle} numberOfLines={1}>{s.name}</Text>
                      <MageAIMark size={16} color={t.accent} />
                    </TouchableOpacity>
                  ))}
                  <TouchableOpacity style={[styles.pickRow, styles.pickRowDashed]} onPress={() => void pickFromLibrary()} activeOpacity={0.8}>
                    <Plus size={16} color={t.accent} strokeWidth={1.75} />
                    <Text style={[styles.pickRowTitle, { color: t.accent }]}>Pick a plan image from your library</Text>
                  </TouchableOpacity>
                  {planSheets.length === 0 && (
                    <Text style={styles.note}>
                      Tip: plan sheets you upload in Visual Takeoff show up here automatically — including their scale calibration.
                    </Text>
                  )}
                </>
              )}
            </>
          )}

          {phase === 'review' && imageUri && (
            <>
              {/* Sheet with detected-room overlay. Container matches the image
                  aspect ratio exactly, so percentage-positioned boxes line up. */}
              <View style={[styles.sheetWrap, { aspectRatio: imageAspect }]}>
                <Image source={{ uri: imageUri }} style={styles.sheetImage} resizeMode="contain" />
                {rooms.map(r => (
                  <TouchableOpacity
                    key={r.id}
                    style={[
                      styles.roomBox,
                      {
                        left: `${r.bbox.x * 100}%` as never,
                        top: `${r.bbox.y * 100}%` as never,
                        width: `${Math.max(3, r.bbox.w * 100)}%` as never,
                        height: `${Math.max(3, r.bbox.h * 100)}%` as never,
                        borderColor: r.included ? t.accent : t.textMuted,
                        opacity: r.included ? 1 : 0.45,
                      },
                    ]}
                    onPress={() => setEditing(r)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.roomBoxLabel, { backgroundColor: r.included ? t.accent : t.textMuted }]} numberOfLines={1}>
                      {r.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={styles.note}>Tap a room on the sheet or in the list to fix sqft, set your rate, or leave a note.</Text>

              {/* Room cards. */}
              {rooms.map(r => (
                <TouchableOpacity key={r.id} style={[styles.roomCard, !r.included && { opacity: 0.5 }]} onPress={() => setEditing(r)} activeOpacity={0.8}>
                  <View style={styles.roomCardHead}>
                    <Text style={styles.roomCardName} numberOfLines={1}>{r.name}</Text>
                    <Text style={styles.roomCardTotal}>{formatMoney(Math.round(r.sqft) * r.ratePerSqft)}</Text>
                  </View>
                  <View style={styles.roomCardMeta}>
                    <Text style={styles.roomCardMetaText}>{ROOM_TYPE_LABELS[r.type]}</Text>
                    <Text style={styles.roomCardDot}>·</Text>
                    <Text style={styles.roomCardMetaText}>{Math.round(r.sqft)} SF @ {formatMoney(r.ratePerSqft)}/SF</Text>
                    {r.memoryApplied && (
                      <View style={styles.learnedChip}><Text style={styles.learnedChipText}>auto-corrected</Text></View>
                    )}
                    {r.rateSource === 'learned' && (
                      <View style={styles.learnedChip}><Text style={styles.learnedChipText}>your rate</Text></View>
                    )}
                    {/* Absence of a positive chip is NOT a disclosure. A room
                        priced off DEFAULT_ROOM_RATES has a placeholder $/SF
                        that came from nobody's job — it has to say so, or a
                        cold-start row reads exactly like a learned one. */}
                    {r.rateSource === 'default' && (
                      <View style={styles.defaultRateChip}>
                        <Text style={styles.defaultRateChipText}>market placeholder — not your rate</Text>
                      </View>
                    )}
                  </View>
                  {(r.note || r.aiNote) ? (
                    <View style={styles.roomNoteRow}>
                      <StickyNote size={12} color={t.textMuted} strokeWidth={1.75} />
                      <Text style={styles.roomNoteText} numberOfLines={2}>{r.note || r.aiNote}</Text>
                    </View>
                  ) : null}
                </TouchableOpacity>
              ))}

              {addedNote ? (
                <View style={styles.addedBanner}>
                  <Check size={15} color={t.success} strokeWidth={1.75} />
                  <Text style={styles.addedBannerText}>{addedNote}</Text>
                </View>
              ) : null}
            </>
          )}
        </ScrollView>
      )}

      {/* Sticky totals + actions. */}
      {phase === 'review' && rooms.length > 0 && (
        <View style={[styles.footer, { paddingBottom: insets.bottom + 10 }]} onLayout={onBottomBarLayout}>
          <View style={styles.footerTotals}>
            <Text style={styles.footerTotalsTop}>{totals.roomCount} rooms · {totals.totalSqft.toLocaleString()} SF</Text>
            <Text style={styles.footerTotalsMain}>{formatMoney(totals.totalCost)}</Text>
            {/* How much of that total is standing on placeholder rates. */}
            {placeholderRoomCount > 0 ? (
              <Text style={styles.footerTotalsWarn} testID="plan-intel-placeholder-note">
                {placeholderRoomCount} room{placeholderRoomCount === 1 ? '' : 's'} on market placeholders — not your rates
              </Text>
            ) : null}
          </View>
          <TouchableOpacity
            style={[styles.footerBtn, styles.footerBtnGhost, taught && { borderColor: t.success }]}
            onPress={handleTeach}
            activeOpacity={0.85}
          >
            <GraduationCap size={16} color={taught ? t.success : t.accent} strokeWidth={1.75} />
            <Text style={[styles.footerBtnGhostText, taught && { color: t.success }]}>{taught ? 'Taught' : 'Teach AI'}</Text>
          </TouchableOpacity>
          {project?.linkedEstimate ? (
            <TouchableOpacity style={styles.footerBtn} onPress={handleAddToEstimate} activeOpacity={0.85}>
              <Plus size={16} color={Colors.textOnAccent} strokeWidth={1.75} />
              <Text style={styles.footerBtnText}>Add to estimate</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      )}

      {/* Edit modal. */}
      <RoomEditModal
        room={editing}
        onClose={() => setEditing(null)}
        onSave={patch => { if (editing) updateRoom(editing.id, patch); setEditing(null); }}
        t={t}
        styles={styles}
      />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────
function RoomEditModal({ room, onClose, onSave, t, styles }: {
  room: PlanRoom | null;
  onClose: () => void;
  onSave: (patch: Partial<PlanRoom>) => void;
  t: ThemeColors;
  styles: ReturnType<typeof makeStyles>;
}) {
  const [name, setName] = useState('');
  const [sqftStr, setSqftStr] = useState('');
  const [rateStr, setRateStr] = useState('');
  const [note, setNote] = useState('');
  const [included, setIncluded] = useState(true);
  const [loadedId, setLoadedId] = useState<string | null>(null);

  // Sync local state when a new room opens (render-time state sync — the
  // sanctioned alternative to a useEffect-on-prop pattern).
  if (room && room.id !== loadedId) {
    setLoadedId(room.id);
    setName(room.name);
    setSqftStr(String(Math.round(room.sqft)));
    setRateStr(String(room.ratePerSqft));
    setNote(room.note ?? '');
    setIncluded(room.included);
  }

  const save = () => {
    if (!room) return;
    const sqft = Math.max(1, parseFloat(sqftStr) || room.sqft);
    const rate = Math.max(0, parseFloat(rateStr) || room.ratePerSqft);
    onSave({
      name: name.trim() || room.name,
      sqft,
      ratePerSqft: rate,
      rateSource: rate !== room.ratePerSqft ? 'user' : room.rateSource,
      note: note.trim() || undefined,
      included,
    });
  };

  return (
    <Modal visible={!!room} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalBackdrop}>
        <View style={styles.modalSheet}>
          <View style={styles.modalHead}>
            <Text style={styles.modalTitle}>{room?.name ?? 'Room'}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
              <X size={20} color={t.textSecondary} strokeWidth={1.75} />
            </TouchableOpacity>
          </View>

          <Text style={styles.fieldLabel}>Room name</Text>
          <TextInput style={styles.fieldInput} value={name} onChangeText={setName} placeholder="Kitchen" placeholderTextColor={t.textMuted} />

          <View style={styles.fieldRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.fieldLabel}>Square feet</Text>
              <TextInput style={styles.fieldInput} value={sqftStr} onChangeText={setSqftStr} keyboardType="numeric" inputMode="numeric" placeholder="0" placeholderTextColor={t.textMuted} />
              {room && Math.round(room.aiSqft) !== Math.round(parseFloat(sqftStr) || 0) ? (
                <Text style={styles.fieldHint}>AI read {Math.round(room.aiSqft)} SF — your fix teaches it</Text>
              ) : null}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.fieldLabel}>Your $/SF</Text>
              <TextInput style={styles.fieldInput} value={rateStr} onChangeText={setRateStr} keyboardType="numeric" inputMode="numeric" placeholder="0" placeholderTextColor={t.textMuted} />
            </View>
          </View>

          <Text style={styles.fieldLabel}>Note for the AI (carried to future plans)</Text>
          <TextInput
            style={[styles.fieldInput, styles.fieldInputMultiline]}
            value={note}
            onChangeText={setNote}
            placeholder='e.g. "client wants heated floors", "include in phase 2 only"'
            placeholderTextColor={t.textMuted}
            multiline
          />

          <View style={styles.includeRow}>
            <Text style={styles.fieldLabel}>Include in estimate</Text>
            <Switch value={included} onValueChange={setIncluded} trackColor={{ true: t.accent }} />
          </View>

          <TouchableOpacity style={styles.modalSave} onPress={save} activeOpacity={0.85}>
            <Check size={16} color={Colors.textOnAccent} strokeWidth={1.75} />
            <Text style={styles.modalSaveText}>Save room</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
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

  memoryChip: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 7,
    backgroundColor: t.surface, borderRadius: Tokens.radius.full,
    borderWidth: 1, borderColor: t.line, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 14,
  },
  memoryChipText: { flex: 1, fontSize: Type.caption1.fontSize, color: t.textMuted, fontWeight: '600' as const },

  errorText: { fontSize: Type.footnote.fontSize, color: t.danger, marginBottom: 12, lineHeight: 19 },
  sectionTitle: { fontSize: Type.subheadline.fontSize, fontWeight: '700' as const, color: t.text, marginBottom: 10, marginTop: 4 },

  pickRow: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10,
    backgroundColor: t.surface, borderRadius: Tokens.radius.card,
    borderWidth: 1, borderColor: t.line, padding: 14, marginBottom: 8,
  },
  pickRowDashed: { borderStyle: 'dashed' as const, borderColor: t.accent + '66', backgroundColor: 'transparent' },
  pickRowTitle: { flex: 1, fontSize: Type.subhead.fontSize, fontWeight: '600' as const, color: t.text },

  resumeCard: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10,
    backgroundColor: t.accent + '14', borderRadius: Tokens.radius.card,
    borderWidth: 1, borderColor: t.accent + '44', padding: 14, marginBottom: 14,
  },
  resumeTitle: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: t.text },
  resumeSub: { fontSize: Type.caption1.fontSize, color: t.textSecondary, marginTop: 1 },

  sheetWrap: {
    width: '100%' as const, backgroundColor: t.surface,
    borderRadius: Tokens.radius.card, borderWidth: 1, borderColor: t.line,
    overflow: 'hidden' as const, marginBottom: 8,
  },
  sheetImage: { width: '100%' as const, height: '100%' as const },
  roomBox: {
    position: 'absolute' as const, borderWidth: 1.5, borderRadius: Tokens.radius.xs,
    justifyContent: 'flex-start' as const, alignItems: 'flex-start' as const,
  },
  roomBoxLabel: {
    fontSize: Type.caption2.fontSize, color: Colors.textOnAccent, fontWeight: '700' as const,
    paddingHorizontal: 4, paddingVertical: 1, borderRadius: Tokens.radius.xs,
    overflow: 'hidden' as const, maxWidth: '100%' as const,
  },

  roomCard: {
    backgroundColor: t.surface, borderRadius: Tokens.radius.card,
    borderWidth: 1, borderColor: t.line, padding: 13, marginBottom: 8, gap: 6,
  },
  roomCardHead: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const },
  roomCardName: { flex: 1, fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: t.text, marginRight: 8 },
  roomCardTotal: { fontSize: Type.subhead.fontSize, fontWeight: '800' as const, color: t.text },
  roomCardMeta: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6, flexWrap: 'wrap' as const },
  roomCardMetaText: { fontSize: Type.caption1.fontSize, color: t.textSecondary, fontWeight: '600' as const },
  roomCardDot: { fontSize: Type.caption1.fontSize, color: t.textMuted },
  learnedChip: { backgroundColor: t.accent + '1A', borderRadius: Tokens.radius.full, paddingHorizontal: 7, paddingVertical: 2 },
  learnedChipText: { fontSize: Type.caption2.fontSize, color: t.accent, fontWeight: '700' as const },
  defaultRateChip: { backgroundColor: t.warningLabel + '1A', borderRadius: Tokens.radius.full, paddingHorizontal: 7, paddingVertical: 2 },
  defaultRateChipText: { fontSize: Type.caption2.fontSize, color: t.warningLabel, fontWeight: '700' as const },
  roomNoteRow: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 6 },
  roomNoteText: { flex: 1, fontSize: Type.caption1.fontSize, color: t.textMuted, lineHeight: 16 },

  addedBanner: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8,
    backgroundColor: t.success + '14', borderRadius: Tokens.radius.card,
    borderWidth: 1, borderColor: t.success + '44', padding: 12, marginTop: 6,
  },
  addedBannerText: { flex: 1, fontSize: Type.footnote.fontSize, color: t.text, fontWeight: '600' as const },

  note: { fontSize: Type.caption1.fontSize, color: t.textMuted, lineHeight: 17, marginBottom: 12 },

  footer: {
    position: 'absolute' as const, left: 0, right: 0, bottom: 0,
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8,
    paddingHorizontal: 16, paddingTop: 10,
    backgroundColor: t.bg, borderTopWidth: 1, borderTopColor: t.line,
  },
  footerTotals: { flex: 1 },
  footerTotalsTop: { fontSize: Type.caption2.fontSize, color: t.textMuted, fontWeight: '600' as const },
  footerTotalsMain: { fontSize: Type.title3.fontSize, fontWeight: '800' as const, color: t.text },
  footerTotalsWarn: { fontSize: Type.caption2.fontSize, color: t.warningLabel, fontWeight: '600' as const },
  footerBtn: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6,
    backgroundColor: t.accent, borderRadius: Tokens.radius.full,
    paddingHorizontal: 16, paddingVertical: 11,
  },
  footerBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: Colors.textOnAccent },
  footerBtnGhost: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: t.accent },
  footerBtnGhostText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: t.accent },

  modalBackdrop: { flex: 1, justifyContent: 'flex-end' as const, backgroundColor: Colors.overlay },
  modalSheet: {
    backgroundColor: t.bg, borderTopLeftRadius: Tokens.radius.xl, borderTopRightRadius: Tokens.radius.xl,
    padding: 20, paddingBottom: 34, gap: 4,
  },
  modalHead: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, marginBottom: 10 },
  modalTitle: { fontSize: Type.title3.fontSize, fontWeight: '800' as const, color: t.text },
  fieldLabel: { fontSize: Type.caption1.fontSize, color: t.textSecondary, fontWeight: '700' as const, marginTop: 10, marginBottom: 5 },
  fieldInput: {
    backgroundColor: t.surface, borderRadius: Tokens.radius.sm, borderWidth: 1, borderColor: t.line,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: Type.subhead.fontSize, color: t.text,
  },
  fieldInputMultiline: { minHeight: 64, textAlignVertical: 'top' as const },
  fieldHint: { fontSize: Type.caption2.fontSize, color: t.accent, marginTop: 4, fontWeight: '600' as const },
  fieldRow: { flexDirection: 'row' as const, gap: 12 },
  includeRow: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, marginTop: 4 },
  modalSave: {
    flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 7,
    backgroundColor: t.accent, borderRadius: Tokens.radius.full, paddingVertical: 13, marginTop: 16,
  },
  modalSaveText: { fontSize: Type.subhead.fontSize, fontWeight: '800' as const, color: Colors.textOnAccent },
});
