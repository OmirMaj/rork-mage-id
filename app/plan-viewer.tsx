// app/plan-viewer.tsx — Single-sheet viewer with pin drop + markup.
//
// Design constraints:
//   • Coords are normalized (0..1) against the image so pins/markup
//     survive zoom/resize. This matters because mobile screens rotate,
//     tablets differ, and the same plan opens on iOS/Android/web.
//   • Pinch-zoom on iOS uses ScrollView `maximumZoomScale` (works out of
//     the box). Android/web fall back to fit-to-view. Adding reanimated
//     pinch is a follow-up — the main value is "drop pins, link stuff,"
//     which works fine at fit scale.
//   • Pin mode is the default. Toggle "Draw" for freehand red strokes.
//     Markup is persisted per-sheet.
//   • Tapping a pin opens the bottom sheet for that pin — link/rename/
//     delete. No drag-to-move in v1; users delete and re-drop if needed.

import React, { useCallback, useEffect, useMemo, useState, useRef, useSyncExternalStore } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Image, Modal, TextInput, Platform, GestureResponderEvent, ImageLoadEventData, NativeSyntheticEvent, LayoutChangeEvent, ActivityIndicator,
} from 'react-native';
import { onlineManager } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useHideBrainFab } from '@/components/brain/brainFabState';
import { Stack, useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import Svg, { Polyline, Line, Circle, Text as SvgText } from 'react-native-svg';
import {
  ChevronLeft, ChevronRight, MapPin, Pencil, Eraser, Camera, ClipboardList, X, Check,
  Trash2, Undo2, Image as ImageIcon, Ruler, FileText, AlertTriangle, ArrowRight, Link2,
} from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { Colors } from '@/constants/colors';
import { MageAIMark } from '@/components/icons';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useProjects } from '@/contexts/ProjectContext';
import { useProjectAccess } from '@/hooks/useProjectAccess';
import { useProjectRoleState } from '@/hooks/useProjectRole';
import Paywall from '@/components/Paywall';
import { Button } from '@/components/ui';
import { useLocalPlanSheetUri } from '@/utils/planSheetLocalFiles';
import type { DrawingPin, DrawingPinKind, PunchItem, PunchItemStatus, RFI } from '@/types';
import { stampPhotoLocation } from '@/utils/photoGeoStamp';
import { generateUUID } from '@/utils/generateId';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { showAlert } from '@/utils/alert';
import { planRevisionStatus, staleBannerCopy } from '@/utils/planRevisionCore';
import {
  planRenumber, planScreenGate, planControlBlock, effectivePlanRole, rfiFromPin, sheetAttachmentFor, attachmentsHaveSheet,
  type SheetPatch, type PlanRole, type PlanGate,
} from '@/utils/plans/revisionActions';
import { containImageRect, imageLoadAspectRatio, planViewerImageRatio } from '@/utils/punchPlanPin';
import { supabaseWrite } from '@/utils/offlineQueue';
import { isSupabaseConfigured } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { planScaleStatus, stampImageFrame, usableCalibration, PLAN_SCALE_RECHECK_COPY } from '@/utils/planScale';

type Mode = 'pin' | 'draw' | 'measure' | 'calibrate';

const CALIBRATE_FRAME_UNKNOWN_COPY = 'This sheet\'s size is unknown, so a scale set now would be measured against the wrong frame. Reopen it once the image has loaded, then calibrate.';

// Minimum pixel distance between two calibration points — below this, the
// scale is meaningless (one-pixel jitter = wild errors in derived units).
const MIN_CALIBRATION_PX = 20;

const PIN_COLORS: Record<DrawingPinKind, string> = {
  note: '#FF6A1A',
  photo: '#3B82F6',
  punch: '#FF9500',
  rfi: '#2F6B6B',
};

// Punch-layer marker colors, keyed by status. These render punch items that
// carry their own plan-pin anchor (planSheetId/pinX/pinY) but have no
// DrawingPin — i.e. walk-mode / AI-punch items. Status coloring lets a GC read
// open vs. closed work at a glance on the sheet.
function punchStatusColor(status: PunchItemStatus, t: ThemeColors): string {
  switch (status) {
    case 'open': return t.danger;
    case 'in_progress': return t.info;
    case 'ready_for_review': return t.accent;
    case 'closed': return t.success;
  }
}

export default function PlanViewerScreen() {
  // #73: the gate is PROJECT-scoped. A foreman invited to the job on a free
  // account opens sheets on the GC's plan ('plan_markup' is in the
  // collaborator grant) — he used to hit "Plan Viewer requires Pro", including
  // from a punch item's "On plan" chip. The route only carries sheetId, so the
  // sheet is resolved first to find its project; every hook runs every render.
  const params = useLocalSearchParams<{ sheetId?: string }>();
  const sheetId = typeof params.sheetId === 'string' ? params.sheetId : undefined;
  const { getPlanSheet } = useProjects();
  const projectId = (sheetId ? getPlanSheet(sheetId) : null)?.projectId;
  const { canAccess, role } = useProjectAccess(projectId);
  const roleState = useProjectRoleState(projectId);
  const offline = useSyncExternalStore(onlineManager.subscribe, () => !onlineManager.isOnline(), () => false);
  const planAccess = canAccess('plan_markup');
  // A sheet this device has not loaded has no project to check; the inner
  // screen says "Sheet not found" rather than guessing a paywall.
  if (!planAccess) {
    return (
      <PlanViewerGate
        gate={projectId ? planScreenGate({ canAccess: planAccess, roleLoading: roleState.isLoading, roleError: roleState.isError, role, offline }) : 'open'}
        role={role}
        onRetry={roleState.refetch}
      />
    );
  }
  return <PlanViewerScreenInner role={role} />;
}

/** #73: what a sheet shows when project access is not (yet) granted: the Pro
 *  paywall for a free owner, a spinner while the role read is in flight, a
 *  retry when it failed, "no access" after it resolved to nothing. */
function PlanViewerGate({ gate, role, onRetry }: { gate: PlanGate; role: PlanRole; onRetry: () => void }) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  if (gate === 'open') return <PlanViewerScreenInner role={role} />;
  if (gate === 'locked') {
    // Gate MUST match the Plans library gate (plans.tsx uses 'plan_markup' = Pro).
    return (
      <Paywall
        visible={true}
        feature="Plan Viewer"
        requiredTier="pro"
        onClose={() => router.back()}
      />
    );
  }
  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
          <ChevronLeft size={22} color={themeColors.text} strokeWidth={1.75} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>Plan sheet</Text>
      </View>
      <View style={styles.gateBox} testID={`plan-viewer-gate-${gate}`}>
        {gate === 'loading' ? (
          <ActivityIndicator size="small" color={themeColors.accent} />
        ) : gate === 'error' ? (
          <>
            <Text style={styles.gateText}>Couldn&apos;t check your access to this job. Check your connection and try again.</Text>
            <Button label="Try again" variant="secondary" size="sm" onPress={onRetry} testID="plan-viewer-role-retry" />
          </>
        ) : (
          <Text style={styles.gateText}>You don&apos;t have access to this project&apos;s plans. Ask the project owner to invite you.</Text>
        )}
      </View>
    </View>
  );
}

function PlanViewerScreenInner({ role }: { role: PlanRole }) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  // Suppress the global Brain FAB rather than pad around it (hands-on UI
  // pass 2026-09-07). The canvas is a full-bleed draw responder — bottom
  // padding would push the sheet off-centre AND the 56pt circle would still
  // swallow markup strokes aimed at the bottom-right of the drawing. This
  // screen already carries its own Brain entry point (the Ask button in the
  // header), so nothing is lost by hiding the global one here.
  useHideBrainFab();
  const router = useRouter();
  const params = useLocalSearchParams<{ sheetId?: string; punchId?: string }>();
  const sheetId = typeof params.sheetId === 'string' ? params.sheetId : undefined;
  // Optional deep-link target: the "On plan" chip on a punch row routes here
  // with the punch id so we can auto-select its linked pin.
  const punchIdParam = typeof params.punchId === 'string' ? params.punchId : undefined;

  const {
    getPlanSheet, getPlanSheetsForProject, updatePlanSheet, getPinsForPlan, addDrawingPin, updateDrawingPin, deleteDrawingPin,
    getMarkupsForPlan, addPlanMarkup, deletePlanMarkup,
    getPhotosForProject, getPunchItemsForProject, addProjectPhoto, addPunchItem,
    upsertPlanCalibration, getCalibrationForPlan,
    addRFI, updateRFI, getRFIsForProject, getProject, refetchPlansFromServer, drawingPins,
  } = useProjects();
  // #74: re-read the plans (a newer revision, a pin the office moved) each
  // time the viewer comes into focus. No pull-to-refresh here — the canvas is
  // a zoom/pan surface and a pull would fight the pan.
  useFocusEffect(useCallback(() => { void refetchPlansFromServer(); }, [refetchPlansFromServer]));

  const { user: authUser } = useAuth();

  const sheet = sheetId ? getPlanSheet(sheetId) : null;
  const sheetUri = useLocalPlanSheetUri();

  // Revision control. addPlanSheet has always marked the prior copy
  // `superseded` when a sheet number is re-uploaded, but the viewer used to
  // render a dead drawing exactly like a live one — so a saved deep link, or
  // a pin someone tapped from the punch list, opened a stale sheet silently.
  // Building off it is demo + RFI + delay + change order, and the GC eats it.
  const projectSheets = useMemo(
    () => (sheet ? getPlanSheetsForProject(sheet.projectId) : []),
    [sheet, getPlanSheetsForProject],
  );
  const revision = useMemo(() => {
    if (!sheet) return null;
    return planRevisionStatus(sheet, projectSheets);
  }, [sheet, projectSheets]);
  const staleBanner = revision ? staleBannerCopy(revision) : null;
  // Only ever navigate on an unambiguous resolution. `ambiguous` (two live
  // copies of one number) and `not_found` still warn — they just don't offer a
  // destination, because sending someone to the wrong sheet is the exact
  // failure this banner exists to prevent.
  const currentSheetId = revision?.current.status === 'resolved' ? revision.current.sheetId : null;

  // `replace`, not `push`: the stale sheet should leave the history stack
  // entirely, so Back doesn't land the user right back on the dead drawing.
  const goToCurrentSheet = useCallback(() => {
    if (!currentSheetId) return;
    router.replace({ pathname: '/plan-viewer' as never, params: { sheetId: currentSheetId } as never });
  }, [currentSheetId, router]);

  // #76: compare two revisions that are BOTH already in the set — this dead
  // sheet against the current one, or a live revision against the copy it
  // replaced. No upload, and Compare knows there is nothing to file.
  const previousSheet = useMemo(
    () => (sheet?.previousSheetId ? projectSheets.find(s => s.id === sheet.previousSheetId) ?? null : null),
    [sheet, projectSheets],
  );
  // #73: a field or viewer seat sees these buttons now that the viewer opens
  // for him; Compare files revisions into the GC's set, so it says why not.
  // The job's owner keeps his controls through a failed/offline role read
  // (projects.user_id on the local row); anyone else's null role is refused
  // with the sentence that is true for why it is null.
  const innerRoleState = useProjectRoleState(sheet?.projectId);
  const offline = useSyncExternalStore(onlineManager.subscribe, () => !onlineManager.isOnline(), () => false);
  const seatRole = effectivePlanRole(role, sheet ? getProject(sheet.projectId) : null, authUser?.id);
  const roleStatus = { isError: innerRoleState.isError, offline };
  const compareBlock = planControlBlock(seatRole, 'compare', roleStatus);
  // #73 follow-up: a VIEWER seat opens the sheet now, but pins, strokes, scale
  // and sheet numbers insert/update at field tier and up (RLS), so his write
  // would vanish silently. Every such control is refused with this sentence.
  const markupBlock = planControlBlock(seatRole, 'markup', roleStatus);
  // A failed role read's refusal says "tap Try again" — the alert carries it.
  const retryButtons = useMemo(() => (seatRole === null && innerRoleState.isError
    ? [{ text: 'Cancel', style: 'cancel' as const }, { text: 'Try again', onPress: innerRoleState.refetch }]
    : undefined), [seatRole, innerRoleState.isError, innerRoleState.refetch]);
  const refuseMarkup = useCallback((): boolean => {
    if (!markupBlock) return false;
    showAlert(seatRole === null ? 'Not available yet' : 'View only', markupBlock, retryButtons);
    return true;
  }, [markupBlock, seatRole, retryButtons]);
  const compareRevisions = useCallback((oldSheetId: string, newSheetId: string) => {
    if (!sheet) return;
    if (compareBlock) { showAlert('Compare not available', compareBlock, retryButtons); return; }
    router.push({ pathname: '/compare-drawings' as never, params: { projectId: sheet.projectId, oldSheetId, newSheetId } as never });
  }, [sheet, router, compareBlock, retryButtons]);

  // ── Sheet number (audit round 2, #21) ───────────────────────────────
  // Revision control keys on the sheet NUMBER, but a PDF import lands every
  // page as "<file> — Page N" with no number, and nothing in the app could add
  // one — so an ASI drop sat beside the IFC sheet with neither marked stale.
  // Typing the number here re-runs the same check addPlanSheet runs on upload
  // (planRenumber), in whichever direction the dates say.
  const [numberDraft, setNumberDraft] = useState<string | null>(null);
  // Same gate ProjectContext uses before it writes: no signed-in user means the
  // row is not ours to patch, and RLS would refuse it anyway.
  const canSyncSheets = !!authUser?.id && isSupabaseConfigured;
  // updatePlanSheet reads the sheet list from its own closure, so two calls in
  // one render would make the second overwrite the first locally. Apply one
  // patch per committed render: the queue drains in the effect below.
  const patchQueue = useRef<SheetPatch[]>([]);
  const drainPatches = useCallback(() => {
    const next = patchQueue.current.shift();
    if (!next) return;
    updatePlanSheet(next.id, next.updates);
    // …and write the chain columns ourselves. updatePlanSheet forwards only
    // name / sheet_number / image_uri / page_number / width / height to
    // Supabase — `revision`, `previous_sheet_id` and `superseded` are dropped,
    // so the chain edit would live in local state alone and the next
    // plan_sheets refetch would resurrect the old copy as live, leaving two
    // current sheets carrying the number after the user was told one was
    // superseded. (B4 review.) Going through offlineQueue keeps the write
    // offline-safe and idempotent; delete this block once ProjectContext's
    // updatePlanSheet forwards the three columns itself.
    const chain: Record<string, unknown> = {};
    if (next.updates.revision !== undefined) chain.revision = next.updates.revision;
    if (next.updates.previousSheetId !== undefined) chain.previous_sheet_id = next.updates.previousSheetId;
    if (next.updates.superseded !== undefined) chain.superseded = next.updates.superseded;
    if (canSyncSheets && Object.keys(chain).length > 0) {
      void supabaseWrite('plan_sheets', 'update', { id: next.id, ...chain, updated_at: new Date().toISOString() });
    }
  }, [updatePlanSheet, canSyncSheets]);
  useEffect(() => {
    if (patchQueue.current.length > 0) drainPatches();
  }, [projectSheets, drainPatches]);

  const saveSheetNumber = useCallback(() => {
    if (!sheet || numberDraft === null) return;
    const plan = planRenumber(sheet, numberDraft, projectSheets);
    if (plan.kind === 'invalid') { showAlert('That is not a sheet number', plan.reason); return; }
    setNumberDraft(null);
    if (plan.kind === 'noop') return;
    patchQueue.current = [...plan.patches];
    drainPatches();
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    if (plan.message) showAlert('Revision updated', plan.message);
  }, [sheet, numberDraft, projectSheets, drainPatches]);

  const [mode, setMode] = useState<Mode>('pin');
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null);
  const [activeStroke, setActiveStroke] = useState<{ x: number; y: number }[]>([]);
  // The container is MEASURED; the image box inside it is DERIVED. It used to
  // be the other way round — imgLayout was set once in onLayout — and a remote
  // plan whose onLoad (and so its ratio) arrived AFTER layout kept imgLayout at
  // the whole container, letterbox included. Every normalised pin then divided
  // by the wrong height, so a walk pin drew up to ~74pt off the spot the super
  // tapped on a portrait photo of a plan. Deriving it means the box is
  // recomputed the moment the ratio lands (validate-punch-plan-pin).
  const [containerSize, setContainerSize] = useState<{ w: number; h: number } | null>(null);
  const [imgNaturalRatio, setImgNaturalRatio] = useState<number | null>(null);
  // The ratio is the loaded image's, else the sheet's stored width/height
  // (planViewerImageRatio — the pin step's precedence, so a walk pin is drawn
  // in the rect it was placed in). The stored fallback is what makes web right:
  // react-native-web's onLoad carries the DOM event, not `source`, so this
  // screen used to get NO ratio on web and drew every pin against the
  // letterboxed container (up to 270 px off). It also covers an offline cold
  // start, where the image never loads at all. Only a sheet with neither falls
  // back to the container as the box.
  const imgRatio = planViewerImageRatio(imgNaturalRatio, sheet);
  const imgLayout = useMemo(
    () => (containerSize ? containImageRect(containerSize, imgRatio) ?? containerSize : null),
    [containerSize, imgRatio],
  );
  // Whether imgLayout is the IMAGE's rect, not the whole-container fallback.
  // A scale is stamped `frame:'image'` (utils/planScale), and every reader
  // then trusts it as measured in the image's own frame. Points tapped while
  // the sheet's size is unknown are in the CONTAINER's frame — the very error
  // the re-check exists to catch — so Calibrate is refused until it is known.
  const imageFrameKnown = !!containerSize && containImageRect(containerSize, imgRatio) != null;
  const drawingRef = useRef<boolean>(false);

  // Measure + calibrate state: holds 0–2 points. Both flows use the same
  // two-tap UX so users don't have to learn two different gestures.
  const [pointBuffer, setPointBuffer] = useState<{ x: number; y: number }[]>([]);
  const [calibrationInput, setCalibrationInput] = useState<{ distanceFt: string; visible: boolean } | null>(null);

  const pins = useMemo(() => sheet ? getPinsForPlan(sheet.id) : [], [sheet, getPinsForPlan]);
  const markups = useMemo(() => sheet ? getMarkupsForPlan(sheet.id) : [], [sheet, getMarkupsForPlan]);
  const projectPhotos = useMemo(() => sheet ? getPhotosForProject(sheet.projectId) : [], [sheet, getPhotosForProject]);
  const projectPunch = useMemo(() => sheet ? getPunchItemsForProject(sheet.projectId) : [], [sheet, getPunchItemsForProject]);
  const selectedPin = selectedPinId ? pins.find(p => p.id === selectedPinId) ?? null : null;
  // The saved scale, used ONLY when it was set in the image frame both this
  // screen and Visual Takeoff now measure in (utils/planScale; audit round 2,
  // #4). An older row was saved against whichever container drew it — this
  // screen's own flex:1 area on one device, or Takeoff's 3:4 canvas — and
  // nothing recorded which, so it is shown as "Re-check scale", not trusted.
  const savedCalibration = useMemo(() => sheet ? getCalibrationForPlan(sheet.id) : undefined, [sheet, getCalibrationForPlan]);
  const calibration = useMemo(() => usableCalibration(savedCalibration) ?? undefined, [savedCalibration]);
  const scaleNeedsRecheck = planScaleStatus(savedCalibration) === 'recheck';

  // Punch layer: punch items anchored to THIS sheet that don't already have a
  // DrawingPin drawn for them (those are rendered via `pins`). This surfaces
  // walk-mode / AI-punch items — which never had a pin — on the drawing.
  const punchOverlay = useMemo(() => {
    if (!sheet) return [] as PunchItem[];
    const linkedIds = new Set(pins.map(p => p.linkedPunchItemId).filter(Boolean) as string[]);
    return projectPunch.filter(p =>
      p.planSheetId === sheet.id &&
      typeof p.pinX === 'number' && typeof p.pinY === 'number' &&
      !linkedIds.has(p.id));
  }, [sheet, pins, projectPunch]);

  // Auto-select the pin linked to a punch item when arriving via the punch
  // list's "On plan" chip. One-shot so closing the sheet doesn't reselect.
  const didSelectPunchRef = useRef<boolean>(false);
  React.useEffect(() => {
    if (didSelectPunchRef.current || !punchIdParam || pins.length === 0) return;
    const match = pins.find(p => p.linkedPunchItemId === punchIdParam);
    if (match) { setSelectedPinId(match.id); didSelectPunchRef.current = true; }
  }, [punchIdParam, pins]);

  // The RFI linked to the selected pin, if any — so the pin sheet can show
  // "RFI #N" and a way back to it instead of offering to raise a duplicate.
  const linkedRfi = useMemo(() => {
    if (!selectedPin?.linkedRfiId || !sheet) return null;
    const r = getRFIsForProject(sheet.projectId).find(x => x.id === selectedPin.linkedRfiId);
    return r ? { id: r.id, number: r.number, subject: r.subject } : null;
  }, [selectedPin?.linkedRfiId, sheet, getRFIsForProject]);

  // Pin → RFI: create an open RFI anchored to this drawing location, link the
  // pin both ways (kind:'rfi' + linkedRfiId), then open the RFI to finish and
  // send. "Pin, ask, done."
  //
  // #77: the recipient never saw the pin — the email and the architect portal
  // carried "the marked location on A-201" and a sheet number in text. The
  // question now names the spot in words (zone + percentages) and the drawing
  // itself rides as an attachment (after any linked photo, which app/rfi.tsx
  // treats as attachment 0). #164: due in 14 CALENDAR days, not an instant.
  const handleRaiseRfi = useCallback(() => {
    if (!sheet || !selectedPin) return;
    const linkedPhoto = selectedPin.linkedPhotoId
      ? projectPhotos.find(p => p.id === selectedPin.linkedPhotoId)
      : undefined;
    const rfi = addRFI(rfiFromPin(
      sheet,
      { x: selectedPin.x, y: selectedPin.y, label: selectedPin.label },
      new Date(),
      {
        // #93/#94: the durable key (storagePath, or the key recovered from the
        // cached value) — offline the cached imageUri is a bare key and the
        // old https-only rule dropped the sheet; a signed URL died in 24 h.
        sheetImageUri: sheetAttachmentFor(sheet),
        photo: linkedPhoto?.uri ? { id: linkedPhoto.id, uri: linkedPhoto.uri } : null,
      },
    ));
    updateDrawingPin(selectedPin.id, { linkedRfiId: rfi.id, kind: 'rfi' });
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setSelectedPinId(null);
    router.push({ pathname: '/rfi' as never, params: { projectId: sheet.projectId, rfiId: rfi.id } as never });
  }, [sheet, selectedPin, projectPhotos, addRFI, updateDrawingPin, router]);

  // #95: RFIs this pin may link to — open (not closed/void) and not already on
  // any pin, so one question never ends up with two pins or two RFIs.
  const linkableRfis = useMemo(() => {
    if (!sheet) return [];
    const pinned = new Set(drawingPins.map(p => p.linkedRfiId).filter(Boolean));
    return getRFIsForProject(sheet.projectId)
      .filter(r => r.status !== 'closed' && r.status !== 'void' && !pinned.has(r.id))
      .map(r => ({ id: r.id, subject: r.subject, number: r.number }));
  }, [sheet, drawingPins, getRFIsForProject]);

  // #95: an RFI raised elsewhere (a marked-up photo, the RFI screen) could never
  // be put on the plan — the only RFI action here created a SECOND RFI. Link
  // the existing one instead: the pin gets linkedRfiId (queued pin write), and
  // an RFI not yet sent gets the sheet attached the way a pin-born RFI does. A
  // sent one is not rewritten — app/rfi.tsx adds the pinned sheet on the next send.
  const handleLinkRfi = useCallback((rfiId: string) => {
    if (!sheet || !selectedPin) return;
    updateDrawingPin(selectedPin.id, { linkedRfiId: rfiId, kind: 'rfi' });
    const rfi = getRFIsForProject(sheet.projectId).find(r => r.id === rfiId);
    const sheetValue = sheetAttachmentFor(sheet);
    if (rfi) {
      const sent = (rfi.handoffs ?? []).some(h => h.toParty === 'architect');
      const updates: Partial<RFI> = {};
      if (!sent && sheetValue && !attachmentsHaveSheet(rfi.attachments ?? [], sheetValue)) {
        updates.attachments = [...(rfi.attachments ?? []), sheetValue];
      }
      if (!(rfi.linkedDrawing ?? '').trim()) updates.linkedDrawing = (sheet.sheetNumber ?? '').trim() || sheet.name;
      if (Object.keys(updates).length > 0) updateRFI(rfi.id, updates);
    }
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [sheet, selectedPin, getRFIsForProject, updateDrawingPin, updateRFI]);

  const openLinkedRfi = useCallback(() => {
    if (!sheet || !linkedRfi) return;
    setSelectedPinId(null);
    router.push({ pathname: '/rfi' as never, params: { projectId: sheet.projectId, rfiId: linkedRfi.id } as never });
  }, [sheet, linkedRfi, router]);

  // Pin → Punch: create a punch item anchored to this pin's location, then link
  // the pin both ways (kind:'punch' + linkedPunchItemId). Closes the pin ↔ punch
  // loop the review flagged as one-directional. Description seeds from the pin
  // label; the GC refines it in the punch list afterward.
  const handleCreatePunchFromPin = useCallback((description: string) => {
    if (!sheet || !selectedPin) return;
    const now = new Date().toISOString();
    const id = generateUUID();
    const punch: PunchItem = {
      id,
      projectId: sheet.projectId,
      description: description.trim() || 'Punch item',
      location: sheet.sheetNumber || sheet.name,
      assignedSub: '',
      dueDate: '',
      priority: 'medium',
      status: 'open',
      planSheetId: sheet.id,
      pinX: selectedPin.x,
      pinY: selectedPin.y,
      createdAt: now,
      updatedAt: now,
    };
    addPunchItem(punch);
    updateDrawingPin(selectedPin.id, { linkedPunchItemId: id, kind: 'punch' });
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setSelectedPinId(null);
    router.push({ pathname: '/punch-list' as never, params: { projectId: sheet.projectId } as never });
  }, [sheet, selectedPin, addPunchItem, updateDrawingPin, router]);

  // Feet-per-normalized-unit (0–1) in each axis. We use the straight-line
  // distance between the two calibration points + a known real distance.
  // This assumes the sheet is drawn at uniform scale (valid for standard
  // architectural plans); plans with different x/y scales would need
  // separate x and y scalars, which is out of scope here.
  const scaleFtPerPx = useMemo(() => {
    if (!calibration || !imgLayout) return null;
    const dx = (calibration.p2.x - calibration.p1.x) * imgLayout.w;
    const dy = (calibration.p2.y - calibration.p1.y) * imgLayout.h;
    const distPx = Math.sqrt(dx * dx + dy * dy);
    if (distPx < 1) return null;
    return calibration.realDistanceFt / distPx;
  }, [calibration, imgLayout]);

  const measuredFt = useMemo(() => {
    if (pointBuffer.length !== 2 || !scaleFtPerPx || !imgLayout) return null;
    const dx = (pointBuffer[1].x - pointBuffer[0].x) * imgLayout.w;
    const dy = (pointBuffer[1].y - pointBuffer[0].y) * imgLayout.h;
    return Math.sqrt(dx * dx + dy * dy) * scaleFtPerPx;
  }, [pointBuffer, scaleFtPerPx, imgLayout]);

  // Convert a touch location to normalized [0, 1] coords in image space.
  const toNormalized = useCallback((ex: number, ey: number): { x: number; y: number } | null => {
    if (!imgLayout) return null;
    const x = Math.max(0, Math.min(1, ex / imgLayout.w));
    const y = Math.max(0, Math.min(1, ey / imgLayout.h));
    return { x, y };
  }, [imgLayout]);

  const handleImgPress = useCallback((e: GestureResponderEvent) => {
    if (!sheet) return;
    const pt = toNormalized(e.nativeEvent.locationX, e.nativeEvent.locationY);
    if (!pt) return;
    if (Platform.OS !== 'web') { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }

    if (mode === 'pin') {
      if (refuseMarkup()) return;
      const pin = addDrawingPin({
        planSheetId: sheet.id,
        projectId: sheet.projectId,
        x: pt.x,
        y: pt.y,
        kind: 'note',
        label: '',
      });
      setSelectedPinId(pin.id);
      return;
    }

    if (mode === 'measure' || mode === 'calibrate') {
      setPointBuffer(buf => {
        // 0 pts: add first. 1 pt: complete the pair. 2 pts: restart.
        if (buf.length === 0) return [pt];
        if (buf.length === 1) {
          const next = [...buf, pt];
          if (mode === 'calibrate' && imgLayout) {
            const dx = (next[1].x - next[0].x) * imgLayout.w;
            const dy = (next[1].y - next[0].y) * imgLayout.h;
            const px = Math.sqrt(dx * dx + dy * dy);
            if (px < MIN_CALIBRATION_PX) {
              showAlert('Points too close', 'Tap two points that are further apart — the longer the reference, the more accurate the scale.');
              return [];
            }
            setCalibrationInput({ distanceFt: '', visible: true });
          }
          return next;
        }
        return [pt]; // restart
      });
    }
  }, [mode, toNormalized, addDrawingPin, sheet, imgLayout, refuseMarkup]);

  // Drawing handlers
  const handleDrawStart = useCallback((e: GestureResponderEvent) => {
    if (mode !== 'draw' || markupBlock) return;
    const pt = toNormalized(e.nativeEvent.locationX, e.nativeEvent.locationY);
    if (!pt) return;
    drawingRef.current = true;
    setActiveStroke([pt]);
  }, [mode, toNormalized, markupBlock]);

  const handleDrawMove = useCallback((e: GestureResponderEvent) => {
    if (mode !== 'draw' || !drawingRef.current) return;
    const pt = toNormalized(e.nativeEvent.locationX, e.nativeEvent.locationY);
    if (!pt) return;
    setActiveStroke((cur) => [...cur, pt]);
  }, [mode, toNormalized]);

  const handleDrawEnd = useCallback(() => {
    if (!sheet || mode !== 'draw' || !drawingRef.current) return;
    drawingRef.current = false;
    if (activeStroke.length >= 2) {
      addPlanMarkup({
        planSheetId: sheet.id,
        projectId: sheet.projectId,
        type: 'freehand',
        color: themeColors.danger,
        strokeWidth: 3,
        points: activeStroke,
      });
    }
    setActiveStroke([]);
  }, [mode, activeStroke, addPlanMarkup, sheet]);

  const handleImageLoad = useCallback((e: NativeSyntheticEvent<ImageLoadEventData>) => {
    // Native reports nativeEvent.source; react-native-web hands over the DOM
    // load event, whose target is the <img> (naturalWidth/naturalHeight).
    const ratio = imageLoadAspectRatio(e);
    if (ratio) setImgNaturalRatio(ratio);
  }, []);

  const handleContainerLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    // Same size back from a re-layout must not make a new object: imgLayout is
    // a useMemo over this, and a fresh identity would re-run every consumer.
    setContainerSize(prev => (prev && prev.w === width && prev.h === height ? prev : { w: width, h: height }));
  }, []);

  const undoLastMarkup = useCallback(() => {
    if (markups.length === 0) return;
    // Markups are stored newest-first; delete the newest one.
    deletePlanMarkup(markups[0].id);
  }, [markups, deletePlanMarkup]);

  const confirmCalibration = useCallback(() => {
    if (!sheet || pointBuffer.length !== 2 || !calibrationInput) return;
    if (!imageFrameKnown) {
      showAlert('Scale not saved', CALIBRATE_FRAME_UNKNOWN_COPY);
      return;
    }
    const ft = Number(calibrationInput.distanceFt.replace(/[^0-9.]/g, ''));
    if (!Number.isFinite(ft) || ft <= 0) {
      showAlert('Enter a distance', 'Type the real-world distance between the two points, in feet.');
      return;
    }
    upsertPlanCalibration({
      planSheetId: sheet.id,
      projectId: sheet.projectId,
      // Image-frame stamp rides the jsonb point (utils/planScale).
      p1: stampImageFrame(pointBuffer[0]),
      p2: stampImageFrame(pointBuffer[1]),
      realDistanceFt: ft,
    });
    setCalibrationInput(null);
    setPointBuffer([]);
    setMode('pin');
  }, [sheet, pointBuffer, calibrationInput, upsertPlanCalibration, imageFrameKnown]);

  const switchMode = useCallback((m: Mode) => {
    setPointBuffer([]);
    setCalibrationInput(null);
    setMode(m);
  }, []);

  if (!sheet) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
            <ChevronLeft size={22} color={themeColors.text} strokeWidth={1.75} />
          </TouchableOpacity>
          <Text style={styles.headerTitle} numberOfLines={1}>Sheet not found</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
          <ChevronLeft size={22} color={themeColors.text} strokeWidth={1.75} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          {/* Tap to set or correct the number. An unnumbered sheet says so —
              it is the reason its revisions never chain. */}
          <TouchableOpacity
            onPress={() => { if (refuseMarkup()) return; setNumberDraft(sheet.sheetNumber ?? ''); }}
            accessibilityRole="button"
            accessibilityLabel={sheet.sheetNumber ? `Sheet number ${sheet.sheetNumber}. Tap to change.` : 'Add a sheet number'}
            testID="plan-viewer-sheet-number"
            hitSlop={6}
          >
            <Text style={[styles.headerEyebrow, !sheet.sheetNumber && { color: themeColors.accent }]}>
              {sheet.sheetNumber ? sheet.sheetNumber : '+ Add sheet number'}
            </Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle} numberOfLines={1}>{sheet.name}</Text>
        </View>
        {calibration ? (
          <View style={[styles.modePill, { backgroundColor: Colors.successLight }]}>
            <Text style={[styles.modePillText, { color: themeColors.success }]}>
              Scale: {calibration.realDistanceFt} ft ref
            </Text>
          </View>
        ) : scaleNeedsRecheck ? (
          <TouchableOpacity
            style={[styles.modePill, { backgroundColor: Colors.warningLight }]}
            onPress={() => {
              // Same up-front block as the Calibrate button: with the frame
              // unknown he would tap two points and type a distance, only
              // for confirmCalibration to refuse it.
              if (refuseMarkup()) return;
              if (!imageFrameKnown) { showAlert('Can\'t calibrate yet', CALIBRATE_FRAME_UNKNOWN_COPY); return; }
              switchMode('calibrate'); showAlert('Re-check scale', PLAN_SCALE_RECHECK_COPY);
            }}
            accessibilityRole="button"
            accessibilityLabel="Re-check scale"
          >
            <Text style={[styles.modePillText, { color: Colors.warning }]}>Re-check scale</Text>
          </TouchableOpacity>
        ) : null}
        <View style={styles.modePill}>
          <Text style={styles.modePillText}>{pins.length} {pins.length === 1 ? 'pin' : 'pins'}</Text>
        </View>
        {/* Ask Your Plans (#163) — opens the Ask box on this job's Plans
            screen. It used to open Plan Intelligence, the room-estimating
            tool, where tapping a sheet starts a metered AI estimate. */}
        <TouchableOpacity
          onPress={() => router.push({ pathname: '/plans' as never, params: { projectId: sheet.projectId, ask: '1' } as never })}
          style={styles.headerBtn}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Ask your plans"
          testID="plan-viewer-ask-btn"
        >
          <MageAIMark size={20} color={themeColors.accent} />
        </TouchableOpacity>
      </View>

      {/* Superseded warning. Non-dismissible by design — it sits above the
          drawing for as long as the drawing is dead. There is no "got it"
          because there is nothing to acknowledge: the sheet stays wrong. */}
      {staleBanner ? (
        <View
          style={styles.staleBanner}
          accessibilityRole="alert"
          accessibilityLabel={`${staleBanner.title}. ${staleBanner.detail}`}
          testID="plan-viewer-superseded-banner"
        >
          <View style={styles.staleBannerRow}>
            <AlertTriangle size={18} color={themeColors.warningLabel} strokeWidth={2} />
            <View style={{ flex: 1 }}>
              <Text style={styles.staleBannerTitle}>{staleBanner.title}</Text>
              <Text style={styles.staleBannerDetail}>{staleBanner.detail}</Text>
            </View>
          </View>
          {currentSheetId ? (
            <TouchableOpacity
              style={styles.staleBannerBtn}
              onPress={goToCurrentSheet}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Open the current revision"
              testID="plan-viewer-open-current"
            >
              <Text style={styles.staleBannerBtnText}>Open current revision</Text>
              <ArrowRight size={15} color={Colors.textOnAccent} strokeWidth={2} />
            </TouchableOpacity>
          ) : null}
          {currentSheetId ? (
            <TouchableOpacity
              style={[styles.revCompareBtn, compareBlock ? styles.blockedBtn : null]}
              onPress={() => compareRevisions(sheet.id, currentSheetId)}
              accessibilityHint={compareBlock ?? undefined}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Compare this sheet with the current revision"
              testID="plan-viewer-compare-current"
            >
              <Text style={styles.revCompareBtnText}>Compare with the current revision</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : !sheet.superseded && previousSheet ? (
        <View style={styles.revRow} testID="plan-viewer-revision-row">
          <Text style={styles.revRowText}>
            Rev {sheet.revision ?? 1}{sheet.sheetNumber ? ` of ${sheet.sheetNumber}` : ''} — replaced Rev {previousSheet.revision ?? 1}
          </Text>
          <TouchableOpacity
            style={[styles.revCompareBtn, compareBlock ? styles.blockedBtn : null]}
            onPress={() => compareRevisions(previousSheet.id, sheet.id)}
            accessibilityHint={compareBlock ?? undefined}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={`Compare with revision ${previousSheet.revision ?? 1}`}
            testID="plan-viewer-compare-previous"
          >
            <Text style={styles.revCompareBtnText}>Compare with Rev {previousSheet.revision ?? 1}</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* Image + overlays */}
      <View style={styles.canvasWrap} onLayout={handleContainerLayout}>
        <ScrollView
          maximumZoomScale={Platform.OS === 'ios' ? 3 : 1}
          minimumZoomScale={1}
          pinchGestureEnabled={Platform.OS === 'ios'}
          style={{ flex: 1 }}
          contentContainerStyle={styles.canvasScroll}
          scrollEnabled={mode !== 'draw'}
          bouncesZoom
        >
          <View
            style={[styles.imageBox, imgLayout ? { width: imgLayout.w, height: imgLayout.h } : null]}
            onStartShouldSetResponder={() => true}
            onMoveShouldSetResponder={() => mode === 'draw'}
            onResponderGrant={handleDrawStart}
            onResponderMove={handleDrawMove}
            onResponderRelease={handleDrawEnd}
            onResponderTerminate={handleDrawEnd}
          >
            {/* #80: the file the day pack saved on this phone when there is
                one — it renders with no signal and after a cold start, when
                imageUri is a bare storage path nothing can fetch. */}
            <Image
              source={{ uri: sheetUri(sheet) }}
              style={styles.image}
              resizeMode="contain"
              onLoad={handleImageLoad}
            />

            {/* Pin-drop tap area (sits on top but only active in pin mode) */}
            {mode === 'pin' ? (
              <TouchableOpacity
                style={StyleSheet.absoluteFill}
                onPress={handleImgPress}
                activeOpacity={1}
              />
            ) : null}

            {/* Persisted markup */}
            {imgLayout && markups.length > 0 ? (
              <Svg
                style={StyleSheet.absoluteFill}
                width={imgLayout.w}
                height={imgLayout.h}
                pointerEvents="none"
              >
                {markups.map(m => (
                  <Polyline
                    key={m.id}
                    points={m.points.map(p => `${p.x * imgLayout.w},${p.y * imgLayout.h}`).join(' ')}
                    stroke={m.color}
                    strokeWidth={m.strokeWidth ?? 3}
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                ))}
              </Svg>
            ) : null}

            {/* Active freehand stroke (still being drawn) */}
            {imgLayout && activeStroke.length > 1 ? (
              <Svg
                style={StyleSheet.absoluteFill}
                width={imgLayout.w}
                height={imgLayout.h}
                pointerEvents="none"
              >
                <Polyline
                  points={activeStroke.map(p => `${p.x * imgLayout.w},${p.y * imgLayout.h}`).join(' ')}
                  stroke={themeColors.danger}
                  strokeWidth={3}
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </Svg>
            ) : null}

            {/* Measure / calibrate overlay */}
            {imgLayout && (mode === 'measure' || mode === 'calibrate') && pointBuffer.length > 0 ? (
              <Svg style={StyleSheet.absoluteFill} width={imgLayout.w} height={imgLayout.h} pointerEvents="none">
                {pointBuffer.map((p, i) => (
                  <Circle key={`pt-${i}`} cx={p.x * imgLayout.w} cy={p.y * imgLayout.h} r={5} fill={themeColors.accent} stroke={themeColors.surface} strokeWidth={2} />
                ))}
                {pointBuffer.length === 2 ? (
                  <>
                    <Line
                      x1={pointBuffer[0].x * imgLayout.w}
                      y1={pointBuffer[0].y * imgLayout.h}
                      x2={pointBuffer[1].x * imgLayout.w}
                      y2={pointBuffer[1].y * imgLayout.h}
                      stroke={themeColors.accent}
                      strokeWidth={2}
                      strokeDasharray="4 4"
                    />
                    {mode === 'measure' && measuredFt != null ? (
                      <>
                        <SvgText
                          x={(pointBuffer[0].x + pointBuffer[1].x) / 2 * imgLayout.w}
                          y={(pointBuffer[0].y + pointBuffer[1].y) / 2 * imgLayout.h - 8}
                          fontSize="14"
                          fontWeight="700"
                          fill={themeColors.surface}
                          stroke={themeColors.surface}
                          strokeWidth="4"
                          textAnchor="middle"
                        >
                          {`${measuredFt.toFixed(1)} ft`}
                        </SvgText>
                        <SvgText
                          x={(pointBuffer[0].x + pointBuffer[1].x) / 2 * imgLayout.w}
                          y={(pointBuffer[0].y + pointBuffer[1].y) / 2 * imgLayout.h - 8}
                          fontSize="14"
                          fontWeight="700"
                          fill={themeColors.accent}
                          textAnchor="middle"
                        >
                          {`${measuredFt.toFixed(1)} ft`}
                        </SvgText>
                      </>
                    ) : null}
                  </>
                ) : null}
              </Svg>
            ) : null}

            {/* Existing calibration reference line (always visible, faint) */}
            {imgLayout && calibration && !(mode === 'calibrate' && pointBuffer.length > 0) ? (
              <Svg style={StyleSheet.absoluteFill} width={imgLayout.w} height={imgLayout.h} pointerEvents="none">
                <Line
                  x1={calibration.p1.x * imgLayout.w}
                  y1={calibration.p1.y * imgLayout.h}
                  x2={calibration.p2.x * imgLayout.w}
                  y2={calibration.p2.y * imgLayout.h}
                  stroke={themeColors.success}
                  strokeWidth={1.5}
                  strokeDasharray="2 4"
                  opacity={0.55}
                />
              </Svg>
            ) : null}

            {/* Pins */}
            {imgLayout && pins.map(pin => (
              <TouchableOpacity
                key={pin.id}
                style={[
                  styles.pin,
                  {
                    left: pin.x * imgLayout.w - 14,
                    top: pin.y * imgLayout.h - 28,
                    backgroundColor: pin.color ?? PIN_COLORS[pin.kind],
                    borderColor: selectedPinId === pin.id ? themeColors.accent : '#FFFFFF',
                    borderWidth: selectedPinId === pin.id ? 3 : 2,
                  },
                ]}
                onPress={() => setSelectedPinId(pin.id)}
                hitSlop={8} accessibilityRole="button" accessibilityLabel="View location">
                <MapPin size={14} color={themeColors.surface} strokeWidth={2.5} />
              </TouchableOpacity>
            ))}

            {/* Punch layer — walk-mode / AI punch items anchored to this sheet
                that have no DrawingPin of their own. Colored by status; tapping
                opens the punch list. */}
            {/* The item he came from ("On plan" on the punch list passes its
                id) is ringed in the accent and drawn last, on top — the same
                marking a selected DrawingPin gets — so on a sheet with forty
                markers he can tell which one he opened. */}
            {imgLayout && [...punchOverlay]
              .sort((a, b) => (a.id === punchIdParam ? 1 : 0) - (b.id === punchIdParam ? 1 : 0))
              .map(p => {
                const isTarget = !!punchIdParam && p.id === punchIdParam;
                return (
                  <TouchableOpacity
                    key={`punch-${p.id}`}
                    style={[
                      styles.pin,
                      {
                        left: (p.pinX ?? 0) * imgLayout.w - 14,
                        top: (p.pinY ?? 0) * imgLayout.h - 28,
                        backgroundColor: punchStatusColor(p.status, themeColors),
                        borderColor: isTarget ? themeColors.accent : '#FFFFFF',
                        borderWidth: isTarget ? 3 : 2,
                      },
                    ]}
                    onPress={() => router.push({ pathname: '/punch-list' as never, params: { projectId: p.projectId } as never })}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={`${isTarget ? 'This punch item' : 'Punch item'}: ${p.description}`}
                    testID={isTarget ? 'plan-viewer-punch-target' : undefined}
                  >
                    <ClipboardList size={13} color={themeColors.surface} strokeWidth={2.5} />
                  </TouchableOpacity>
                );
              })}
          </View>
        </ScrollView>
      </View>

      {/* Mode hint line (measure / calibrate) */}
      {(mode === 'measure' || mode === 'calibrate') && (
        <View style={styles.hintBar}>
          <Ruler size={14} color={themeColors.accent} strokeWidth={1.75} />
          <Text style={styles.hintText}>
            {mode === 'measure'
              ? (scaleFtPerPx
                ? (pointBuffer.length === 0 ? 'Tap the start of your measurement.' :
                   pointBuffer.length === 1 ? 'Tap the end point.' :
                   measuredFt != null ? `${measuredFt.toFixed(1)} ft — tap again to re-measure.` : 'Measuring\u2026')
                : (scaleNeedsRecheck ? PLAN_SCALE_RECHECK_COPY : 'Calibrate the sheet first \u2014 tap Calibrate.'))
              : (pointBuffer.length === 0 ? 'Tap one end of a known reference (e.g. a dimensioned wall).' :
                 pointBuffer.length === 1 ? 'Now tap the other end.' : 'Got it \u2014 enter the distance.')}
          </Text>
          <TouchableOpacity onPress={() => { setPointBuffer([]); setMode('pin'); }} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
            <X size={14} color={themeColors.textSecondary} strokeWidth={1.75} />
          </TouchableOpacity>
        </View>
      )}

      {/* Toolbar */}
      <View style={[styles.toolbar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        <TouchableOpacity
          style={[styles.toolBtn, mode === 'pin' && styles.toolBtnActive, markupBlock ? styles.blockedBtn : null]}
          onPress={() => { if (refuseMarkup()) return; switchMode('pin'); }}
          accessibilityHint={markupBlock ?? undefined}
        >
          <MapPin size={18} color={mode === 'pin' ? '#FFFFFF' : themeColors.text} strokeWidth={1.75} />
          <Text style={[styles.toolBtnText, mode === 'pin' && styles.toolBtnTextActive]}>Pin</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.toolBtn, mode === 'draw' && styles.toolBtnActive, markupBlock ? styles.blockedBtn : null]}
          onPress={() => { if (refuseMarkup()) return; switchMode('draw'); }}
          accessibilityHint={markupBlock ?? undefined}
          testID="plan-viewer-tool-draw"
        >
          <Pencil size={18} color={mode === 'draw' ? '#FFFFFF' : themeColors.text} strokeWidth={1.75} />
          <Text style={[styles.toolBtnText, mode === 'draw' && styles.toolBtnTextActive]}>Draw</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.toolBtn, mode === 'measure' && styles.toolBtnActive]}
          onPress={() => {
            if (!scaleFtPerPx) {
              // Calibrate must happen first — switch to calibrate mode and
              // hint the user (mirrors area-takeoff.tsx:472 pattern). Same
              // up-front frame block as Calibrate and the Re-check pill, and
              // an older scale is called a re-check, not "no scale".
              // No scale yet: Measure would route him into Calibrate, which
              // writes the sheet's scale — a viewer is told why instead.
              if (refuseMarkup()) return;
              if (!imageFrameKnown) { showAlert('Can\'t calibrate yet', CALIBRATE_FRAME_UNKNOWN_COPY); return; }
              switchMode('calibrate');
              if (scaleNeedsRecheck) {
                showAlert('Re-check scale', PLAN_SCALE_RECHECK_COPY);
              } else {
                showAlert(
                  'Set sheet scale first',
                  'Tap two points a known distance apart (e.g. a door = 3 ft). Measure unlocks once the scale is set.',
                  [{ text: 'OK' }],
                );
              }
              return;
            }
            switchMode('measure');
          }}
        >
          <Ruler size={18} color={!scaleFtPerPx ? themeColors.textMuted : mode === 'measure' ? '#FFFFFF' : themeColors.text} strokeWidth={1.75} />
          <Text style={[
            styles.toolBtnText,
            mode === 'measure' && styles.toolBtnTextActive,
            !scaleFtPerPx && styles.toolBtnTextDisabled,
          ]}>Measure</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.toolBtn, mode === 'calibrate' && styles.toolBtnActive, markupBlock ? styles.blockedBtn : null]}
          accessibilityHint={markupBlock ?? undefined}
          testID="plan-viewer-tool-calibrate"
          onPress={() => {
            // Blocked, and says why: see markupBlock and imageFrameKnown.
            if (refuseMarkup()) return;
            if (!imageFrameKnown) { showAlert('Can\'t calibrate yet', CALIBRATE_FRAME_UNKNOWN_COPY); return; }
            switchMode('calibrate');
          }}
        >
          <Check size={18} color={mode === 'calibrate' ? '#FFFFFF' : (calibration ? themeColors.success : themeColors.text)} strokeWidth={1.75} />
          <Text style={[styles.toolBtnText, mode === 'calibrate' && styles.toolBtnTextActive]}>
            {calibration ? 'Re-cal' : 'Calibrate'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.toolBtn, markupBlock ? styles.blockedBtn : null]} onPress={() => { if (refuseMarkup()) return; undoLastMarkup(); }} disabled={markups.length === 0} accessibilityHint={markupBlock ?? undefined}>
          <Undo2 size={18} color={markups.length === 0 ? themeColors.textMuted : themeColors.text} strokeWidth={1.75} />
          <Text style={[styles.toolBtnText, markups.length === 0 && styles.toolBtnTextDisabled]}>Undo</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.toolBtn, markupBlock ? styles.blockedBtn : null]} accessibilityHint={markupBlock ?? undefined} onPress={() => {
          if (markups.length === 0) return;
          if (refuseMarkup()) return;
          showAlert('Clear markup', 'Remove all strokes on this sheet?', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Clear', style: 'destructive', onPress: () => markups.forEach(m => deletePlanMarkup(m.id)) },
          ]);
        }} disabled={markups.length === 0}>
          <Eraser size={18} color={markups.length === 0 ? themeColors.textMuted : themeColors.text} strokeWidth={1.75} />
          <Text style={[styles.toolBtnText, markups.length === 0 && styles.toolBtnTextDisabled]}>Clear</Text>
        </TouchableOpacity>
      </View>

      {/* Pin detail modal */}
      <PinDetailModal
        pin={selectedPin}
        projectId={sheet.projectId}
        photos={projectPhotos}
        punchItems={projectPunch}
        linkedRfi={linkedRfi}
        linkableRfis={linkableRfis}
        readOnlyReason={markupBlock}
        onRaiseRfi={() => { if (refuseMarkup()) return; handleRaiseRfi(); }}
        onLinkRfi={(id) => { if (refuseMarkup()) return; handleLinkRfi(id); }}
        onOpenRfi={openLinkedRfi}
        onCreatePunch={(d) => { if (refuseMarkup()) return; handleCreatePunchFromPin(d); }}
        onClose={() => setSelectedPinId(null)}
        onUpdate={(updates) => {
          if (refuseMarkup()) return; // the label field is read-only; link/unlink taps say why
          if (selectedPin) updateDrawingPin(selectedPin.id, updates);
        }}
        onDelete={() => {
          if (refuseMarkup()) return;
          if (selectedPin) {
            deleteDrawingPin(selectedPin.id);
            setSelectedPinId(null);
          }
        }}
        onAddPhoto={async () => {
          if (!selectedPin || refuseMarkup()) return;
          const perm = await ImagePicker.requestCameraPermissionsAsync();
          if (perm.status !== 'granted') { showAlert('Permission needed', 'Camera access is required.'); return; }
          const result = await ImagePicker.launchCameraAsync({ quality: 0.7, allowsEditing: false });
          if (result.canceled || !result.assets?.[0]) return;
          const uri = result.assets[0].uri;
          const id = generateUUID();
          const now = new Date().toISOString();
          // Geo-stamp \u2014 self-bounded 3s timeout, never blocks the save.
          const stamp = await stampPhotoLocation();
          addProjectPhoto({
            id, projectId: sheet.projectId, uri, timestamp: now,
            tag: 'plan', createdAt: now,
            ...(stamp ? {
              latitude: stamp.latitude,
              longitude: stamp.longitude,
              locationAccuracyMeters: stamp.accuracyMeters,
              locationLabel: stamp.label,
            } : null),
          });
          updateDrawingPin(selectedPin.id, { linkedPhotoId: id, kind: 'photo' });
        }}
      />

      {/* Sheet number modal */}
      <Modal
        visible={numberDraft !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setNumberDraft(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { paddingBottom: 24 }]}>
            <View style={styles.modalHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <FileText size={16} color={themeColors.accent} strokeWidth={1.75} />
                <Text style={styles.modalTitle}>Sheet number</Text>
              </View>
              <TouchableOpacity onPress={() => setNumberDraft(null)} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Close">
                <X size={18} color={themeColors.text} strokeWidth={1.75} />
              </TouchableOpacity>
            </View>
            <Text style={styles.emptyHint}>
              The number printed in the title block, like A-201. Revisions chain on this: a later copy of the same number marks the earlier one superseded.
            </Text>
            <TextInput
              value={numberDraft ?? ''}
              onChangeText={setNumberDraft}
              placeholder="A-201"
              placeholderTextColor={themeColors.textMuted}
              autoCapitalize="characters"
              autoCorrect={false}
              style={styles.input}
              autoFocus
              testID="plan-viewer-sheet-number-input"
            />
            <TouchableOpacity style={[styles.primaryBtn, { marginTop: 10 }]} onPress={saveSheetNumber} testID="plan-viewer-sheet-number-save">
              <Check size={16} color={Colors.textOnAccent} strokeWidth={1.75} />
              <Text style={styles.primaryBtnText}>Save sheet number</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Calibration input modal */}
      <Modal
        visible={!!calibrationInput?.visible}
        transparent
        animationType="fade"
        onRequestClose={() => { setCalibrationInput(null); setPointBuffer([]); }}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { paddingBottom: 24 }]}>
            <View style={styles.modalHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ruler size={16} color={themeColors.accent} strokeWidth={1.75} />
                <Text style={styles.modalTitle}>Set scale</Text>
              </View>
              <TouchableOpacity onPress={() => { setCalibrationInput(null); setPointBuffer([]); }} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Close">
                <X size={18} color={themeColors.text} strokeWidth={1.75} />
              </TouchableOpacity>
            </View>
            <Text style={styles.emptyHint}>
              What{"\u2019"}s the real distance between those two points? Pick something dimensioned on the sheet \u2014 a known wall length or grid line.
            </Text>
            <View style={styles.distanceRow}>
              <TextInput
                value={calibrationInput?.distanceFt ?? ''}
                onChangeText={(t) => setCalibrationInput(ci => ci ? { ...ci, distanceFt: t } : ci)}
                placeholder="20"
                keyboardType="decimal-pad"
                style={[styles.input, { flex: 1 }]}
                autoFocus
              />
              <Text style={styles.unitLabel}>ft</Text>
            </View>
            <TouchableOpacity style={[styles.primaryBtn, { marginTop: 10 }]} onPress={confirmCalibration}>
              <Check size={16} color={'#FFFFFF'} strokeWidth={1.75} />
              <Text style={styles.primaryBtnText}>Set scale</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// Pin detail / edit

function PinDetailModal({
  pin, projectId, photos, punchItems, linkedRfi, linkableRfis, readOnlyReason,
  onClose, onUpdate, onDelete, onAddPhoto, onRaiseRfi, onLinkRfi, onOpenRfi, onCreatePunch,
}: {
  pin: DrawingPin | null;
  projectId: string;
  photos: { id: string; uri: string; tag?: string }[];
  punchItems: { id: string; description: string; location?: string; status: string }[];
  linkedRfi: { id: string; number: number; subject: string } | null;
  /** #95: open RFIs on this project no pin carries yet. */
  linkableRfis: { id: string; number: number; subject: string }[];
  /** Set for a seat that may not write pins (viewer): shown, and the label is read-only. */
  readOnlyReason?: string | null;
  onClose: () => void;
  onUpdate: (updates: Partial<DrawingPin>) => void;
  onDelete: () => void;
  onAddPhoto: () => void;
  onRaiseRfi: () => void;
  onLinkRfi: (rfiId: string) => void;
  onOpenRfi: () => void;
  onCreatePunch: (description: string) => void;
}) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [draftLabel, setDraftLabel] = useState<string>('');
  const [view, setView] = useState<'main' | 'photo' | 'punch' | 'rfi'>('main');

  React.useEffect(() => {
    if (pin) { setDraftLabel(pin.label ?? ''); setView('main'); }
  }, [pin?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!pin) return null;

  const linkedPhoto = pin.linkedPhotoId ? photos.find(p => p.id === pin.linkedPhotoId) : null;
  const linkedPunch = pin.linkedPunchItemId ? punchItems.find(p => p.id === pin.linkedPunchItemId) : null;

  const saveLabel = () => {
    onUpdate({ label: draftLabel.trim() || undefined });
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={[styles.modalPinBadge, { backgroundColor: pin.color ?? PIN_COLORS[pin.kind] }]}>
                <MapPin size={12} color={themeColors.surface} strokeWidth={1.75} />
              </View>
              <Text style={styles.modalTitle}>
                {view === 'main' ? 'Pin' : view === 'photo' ? 'Link a photo' : view === 'rfi' ? 'Link an existing RFI' : 'Link a punch item'}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Close"><X size={18} color={themeColors.text} strokeWidth={1.75} /></TouchableOpacity>
          </View>

          {view === 'main' && (
            <>
              {readOnlyReason ? (
                <Text style={styles.readOnlyNote} testID="pin-read-only-reason">{readOnlyReason}</Text>
              ) : null}
              <Text style={styles.label}>Label</Text>
              <TextInput
                editable={!readOnlyReason}
                value={draftLabel}
                onChangeText={setDraftLabel}
                onBlur={saveLabel}
                placeholder={"Optional \u2014 e.g. \u201Ccracked tile\u201D"}
                style={styles.input}
                multiline
              />

              <View style={styles.linkRow}>
                <TouchableOpacity
                  style={styles.linkCell}
                  onPress={onAddPhoto}
                >
                  <Camera size={16} color={themeColors.accent} strokeWidth={1.75} />
                  <Text style={styles.linkCellTitle}>Take photo</Text>
                  <Text style={styles.linkCellSub}>Shoot & pin it here</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.linkCell} onPress={() => setView('photo')}>
                  <ImageIcon size={16} color={themeColors.accent} strokeWidth={1.75} />
                  <Text style={styles.linkCellTitle}>Existing photo</Text>
                  <Text style={styles.linkCellSub}>Link one already on file</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.linkCell} onPress={() => setView('punch')}>
                  <ClipboardList size={16} color={themeColors.accent} strokeWidth={1.75} />
                  <Text style={styles.linkCellTitle}>Link punch</Text>
                  <Text style={styles.linkCellSub}>Link to open punch</Text>
                </TouchableOpacity>
              </View>

              {/* Pin → Punch: create a NEW punch item anchored to this pin. The
                  primary create surface competitors lead with. Hidden once a
                  punch is already linked to this pin. */}
              {!linkedPunch ? (
                <TouchableOpacity style={styles.createPunchBtn} onPress={() => onCreatePunch(draftLabel)} activeOpacity={0.85} testID="pin-create-punch">
                  <ClipboardList size={16} color={themeColors.accent} strokeWidth={1.75} />
                  <Text style={styles.createPunchBtnText}>Create punch item here</Text>
                  <ChevronRight size={16} color={themeColors.accent} strokeWidth={1.75} />
                </TouchableOpacity>
              ) : null}

              {/* RFI from this drawing location — Pin, Ask, Done. */}
              {linkedRfi ? (
                <TouchableOpacity style={styles.linkedRow} onPress={onOpenRfi} activeOpacity={0.8} testID="pin-open-rfi">
                  <FileText size={14} color={PIN_COLORS.rfi} strokeWidth={1.75} />
                  <Text style={styles.linkedText} numberOfLines={1}>RFI #{linkedRfi.number}: {linkedRfi.subject}</Text>
                  <ChevronRight size={16} color={themeColors.textSecondary} strokeWidth={1.75} />
                </TouchableOpacity>
              ) : (
                <>
                  <TouchableOpacity style={styles.rfiBtn} onPress={onRaiseRfi} activeOpacity={0.85} accessibilityRole="button" testID="pin-raise-rfi">
                    <FileText size={16} color={themeColors.accent} strokeWidth={1.75} />
                    <Text style={styles.rfiBtnText}>Raise RFI from this location</Text>
                    <ChevronRight size={16} color={themeColors.accent} strokeWidth={1.75} />
                  </TouchableOpacity>
                  {/* #95: an RFI raised from a photo or the RFI screen goes on
                      the plan HERE, instead of a second RFI for one question. */}
                  <TouchableOpacity style={styles.linkedRow} onPress={() => setView('rfi')} activeOpacity={0.8} accessibilityRole="button" testID="pin-link-existing-rfi">
                    <Link2 size={14} color={themeColors.accent} strokeWidth={1.75} />
                    <Text style={styles.linkedText} numberOfLines={1}>
                      {linkableRfis.length > 0
                        ? `Link an existing RFI (${linkableRfis.length} open)`
                        : 'Link an existing RFI \u2014 none open without a pin'}
                    </Text>
                    <ChevronRight size={16} color={themeColors.textSecondary} strokeWidth={1.75} />
                  </TouchableOpacity>
                </>
              )}

              {linkedPhoto && (
                <View style={styles.linkedRow}>
                  <Image source={{ uri: linkedPhoto.uri }} style={styles.linkedThumb} />
                  <Text style={styles.linkedText}>Photo linked</Text>
                  <TouchableOpacity onPress={() => onUpdate({ linkedPhotoId: undefined, kind: 'note' })} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Close">
                    <X size={14} color={themeColors.textSecondary} strokeWidth={1.75} />
                  </TouchableOpacity>
                </View>
              )}
              {linkedPunch && (
                <View style={styles.linkedRow}>
                  <ClipboardList size={14} color={themeColors.accent} strokeWidth={1.75} />
                  <Text style={styles.linkedText} numberOfLines={2}>{linkedPunch.description}</Text>
                  <TouchableOpacity onPress={() => onUpdate({ linkedPunchItemId: undefined, kind: 'note' })} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Close">
                    <X size={14} color={themeColors.textSecondary} strokeWidth={1.75} />
                  </TouchableOpacity>
                </View>
              )}

              <TouchableOpacity style={styles.deleteBtn} onPress={() => {
                showAlert('Delete pin', 'Remove this pin?', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Delete', style: 'destructive', onPress: onDelete },
                ]);
              }}>
                <Trash2 size={15} color={themeColors.danger} strokeWidth={1.75} />
                <Text style={styles.deleteBtnText}>Delete pin</Text>
              </TouchableOpacity>
            </>
          )}

          {view === 'photo' && (
            <PhotoPicker
              photos={photos}
              onPick={(photoId) => { onUpdate({ linkedPhotoId: photoId, kind: 'photo' }); setView('main'); }}
              onBack={() => setView('main')}
            />
          )}

          {view === 'rfi' && (
            <RfiPicker
              items={linkableRfis}
              onPick={(id) => { onLinkRfi(id); setView('main'); }}
              onBack={() => setView('main')}
            />
          )}

          {view === 'punch' && (
            <PunchPicker
              items={punchItems}
              onPick={(id) => { onUpdate({ linkedPunchItemId: id, kind: 'punch' }); setView('main'); }}
              onBack={() => setView('main')}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

function PhotoPicker({ photos, onPick, onBack }: {
  photos: { id: string; uri: string; tag?: string }[];
  onPick: (id: string) => void;
  onBack: () => void;
}) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View>
      <TouchableOpacity onPress={onBack} style={styles.backLink} accessibilityRole="button">
        <ChevronLeft size={14} color={themeColors.accent} strokeWidth={1.75} />
        <Text style={styles.backLinkText}>Back</Text>
      </TouchableOpacity>
      {photos.length === 0 ? (
        <Text style={styles.emptyHint}>No photos on this project yet.</Text>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 8 }}>
          {photos.map(p => (
            <TouchableOpacity key={p.id} onPress={() => onPick(p.id)} style={styles.photoTile} accessibilityRole="button" accessibilityLabel="Add image">
              <Image source={{ uri: p.uri }} style={styles.photoTileImg} />
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

/** #95: open RFIs no pin carries yet. Shown without a number: the list's
 *  number is this device's copy, and the RFI screen shows the confirmed one. */
function RfiPicker({ items, onPick, onBack }: {
  items: { id: string; subject: string }[];
  onPick: (id: string) => void;
  onBack: () => void;
}) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View>
      <TouchableOpacity onPress={onBack} style={styles.backLink} accessibilityRole="button">
        <ChevronLeft size={14} color={themeColors.accent} strokeWidth={1.75} />
        <Text style={styles.backLinkText}>Back</Text>
      </TouchableOpacity>
      {items.length === 0 ? (
        <Text style={styles.emptyHint} testID="pin-rfi-picker-empty">
          No open RFIs to link {'\u2014'} every open RFI on this project is already on a pin, or there are none. Use {'\u201C'}Raise RFI from this location{'\u201D'} instead.
        </Text>
      ) : (
        <ScrollView style={{ maxHeight: 260 }}>
          {items.map(r => (
            <TouchableOpacity key={r.id} onPress={() => onPick(r.id)} style={styles.punchRow} accessibilityRole="button" testID={`pin-rfi-pick-${r.id}`}>
              <FileText size={14} color={themeColors.accent} strokeWidth={1.75} />
              <View style={{ flex: 1 }}>
                <Text style={styles.punchRowTitle} numberOfLines={2}>{r.subject || 'Untitled RFI'}</Text>
              </View>
              <Check size={14} color={themeColors.accent} strokeWidth={1.75} />
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function PunchPicker({ items, onPick, onBack }: {
  items: { id: string; description: string; location?: string; status: string }[];
  onPick: (id: string) => void;
  onBack: () => void;
}) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const open = items.filter(i => i.status !== 'closed');
  return (
    <View>
      <TouchableOpacity onPress={onBack} style={styles.backLink} accessibilityRole="button">
        <ChevronLeft size={14} color={themeColors.accent} strokeWidth={1.75} />
        <Text style={styles.backLinkText}>Back</Text>
      </TouchableOpacity>
      {open.length === 0 ? (
        <Text style={styles.emptyHint}>No open punch items on this project.</Text>
      ) : (
        <ScrollView style={{ maxHeight: 260 }}>
          {open.map(pi => (
            <TouchableOpacity key={pi.id} onPress={() => onPick(pi.id)} style={styles.punchRow}>
              <ClipboardList size={14} color={themeColors.accent} strokeWidth={1.75} />
              <View style={{ flex: 1 }}>
                <Text style={styles.punchRowTitle} numberOfLines={2}>{pi.description}</Text>
                {pi.location ? <Text style={styles.punchRowSub}>{pi.location}</Text> : null}
              </View>
              <Check size={14} color={themeColors.accent} strokeWidth={1.75} />
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: '#1C1C1E' },
  // #73 access gate (spinner / retry / no access) — centred in the dark root.
  gateBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  gateText: { ...Type.subhead, color: Colors.textOnAccent, textAlign: 'center' },
  blockedBtn: { opacity: 0.5 },
  readOnlyNote: { color: t.textSecondary, fontSize: Type.footnote.fontSize, lineHeight: 18 },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 14, paddingVertical: 10,
    backgroundColor: t.surface, borderBottomColor: t.line, borderBottomWidth: 1,
  },
  headerBtn: { padding: 6, borderRadius: Tokens.radius.sm },
  headerEyebrow: { color: t.textSecondary, fontSize: Type.caption2.fontSize, fontWeight: '600', letterSpacing: 0.6, textTransform: 'uppercase' },
  headerTitle: { ...Type.serifHeadline, color: t.text },
  modePill: { backgroundColor: t.surfaceAlt, paddingHorizontal: 10, paddingVertical: 5, borderRadius: Tokens.radius.md },
  modePillText: { color: t.text, fontSize: Type.caption1.fontSize, fontWeight: '600' },

  // Superseded banner — amber (warning), not red. Red is `danger`, which this
  // screen already spends on delete/markup strokes; amber reads as "stop and
  // check" without competing with a destructive action.
  staleBanner: {
    backgroundColor: t.warningSoft,
    borderBottomColor: t.warningLabel + '55', borderBottomWidth: 1,
    paddingHorizontal: 14, paddingVertical: 10, gap: 8,
  },
  staleBannerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  staleBannerTitle: {
    color: t.warningLabel, fontSize: Type.footnote.fontSize, fontWeight: '700',
    letterSpacing: 0.2,
  },
  staleBannerDetail: {
    color: t.text, fontSize: Type.caption1.fontSize, fontWeight: '500',
    marginTop: 2, lineHeight: Type.caption1.lineHeight,
  },
  staleBannerBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: t.warningLabel,
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: Tokens.radius.md,
  },
  staleBannerBtnText: { color: Colors.textOnAccent, fontSize: Type.footnote.fontSize, fontWeight: '700' },
  revCompareBtn: {
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: Tokens.radius.md,
    borderWidth: 1, borderColor: t.line,
  },
  revCompareBtnText: { color: t.text, fontSize: Type.caption1.fontSize, fontWeight: '700' },
  revRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 14, paddingVertical: 8,
    borderBottomColor: t.line, borderBottomWidth: 1, backgroundColor: t.surfaceAlt,
  },
  revRowText: { flex: 1, color: t.textSecondary, fontSize: Type.caption1.fontSize, fontWeight: '600' },

  canvasWrap: { flex: 1, backgroundColor: '#1C1C1E', overflow: 'hidden' },
  canvasScroll: { flexGrow: 1, justifyContent: 'center', alignItems: 'center' },
  imageBox: { position: 'relative' },
  image: { width: '100%', height: '100%' },

  pin: {
    position: 'absolute',
    width: 28, height: 28, borderRadius: Tokens.radius.lg,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.35, shadowRadius: 3,
    elevation: 4,
  },

  toolbar: {
    flexDirection: 'row', backgroundColor: t.surface,
    paddingHorizontal: 12, paddingTop: 10,
    borderTopColor: t.line, borderTopWidth: 1,
    gap: 6, justifyContent: 'space-around',
  },
  toolBtn: {
    flex: 1, alignItems: 'center', gap: 2,
    paddingVertical: 8, paddingHorizontal: 6, borderRadius: Tokens.radius.md,
  },
  toolBtnActive: { backgroundColor: t.accentFill },
  toolBtnText: { color: t.text, fontSize: Type.caption2.fontSize, fontWeight: '600', marginTop: 2 },
  toolBtnTextActive: { color: '#FFFFFF' },
  toolBtnTextDisabled: { color: t.textMuted },

  hintBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 14, paddingVertical: 8,
    backgroundColor: '#F0F9F2',
    borderTopColor: t.line, borderTopWidth: 1,
    borderBottomColor: t.line, borderBottomWidth: 1,
  },
  hintText: { flex: 1, color: t.text, fontSize: Type.caption1.fontSize, fontWeight: '500' },

  distanceRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  unitLabel: { color: t.textSecondary, fontSize: Type.footnote.fontSize, fontWeight: '600' },
  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: t.accentFill, paddingHorizontal: 14, paddingVertical: 11, borderRadius: Tokens.radius.md,
  },
  primaryBtnText: { color: '#FFFFFF', fontSize: Type.bodyCompact.fontSize, fontWeight: '700' },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: t.surface, padding: 16, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    gap: 10, maxHeight: '80%',
    ...Platform.select({ web: { maxWidth: 520, alignSelf: 'center', width: '100%', borderRadius: Tokens.radius.panel, marginBottom: 20 } as object, default: {} as object }),
  },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  modalTitle: { color: t.text, fontSize: Type.callout.fontSize, fontWeight: '700' },
  modalPinBadge: { width: 24, height: 24, borderRadius: Tokens.radius.card, alignItems: 'center', justifyContent: 'center' },
  iconBtn: { padding: 6, borderRadius: Tokens.radius.sm },
  label: { color: t.textSecondary, fontSize: Type.caption1.fontSize, fontWeight: '600' },
  input: {
    backgroundColor: t.surfaceAlt, borderRadius: Tokens.radius.md, paddingHorizontal: 12, paddingVertical: 10,
    color: t.text, fontSize: Type.bodyCompact.fontSize, borderColor: t.line, borderWidth: 1, minHeight: 44,
  },

  linkRow: { flexDirection: 'row', gap: 8, marginTop: 6 },
  linkCell: {
    flex: 1, backgroundColor: t.surfaceAlt, padding: 10, borderRadius: Tokens.radius.md,
    borderColor: t.line, borderWidth: 1, gap: 3,
  },
  linkCellTitle: { color: t.text, fontSize: Type.caption1.fontSize, fontWeight: '700', marginTop: 4 },
  linkCellSub: { color: t.textSecondary, fontSize: 10 },

  linkedRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: t.successSoft, padding: 10, borderRadius: Tokens.radius.md, marginTop: 6,
  },
  linkedThumb: { width: 36, height: 36, borderRadius: Tokens.radius.xs },
  linkedText: { flex: 1, color: t.text, fontSize: Type.caption1.fontSize, fontWeight: '600' },

  rfiBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: t.accent + '12', padding: 12, borderRadius: Tokens.radius.md, marginTop: 8,
    borderWidth: 1, borderColor: t.accent + '2A',
  },
  rfiBtnText: { flex: 1, color: t.accent, fontSize: Type.footnote.fontSize, fontWeight: '800' },

  createPunchBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: t.accent + '12', padding: 12, borderRadius: Tokens.radius.md, marginTop: 8,
    borderWidth: 1, borderColor: t.accent + '2A',
  },
  createPunchBtnText: { flex: 1, color: t.accent, fontSize: Type.footnote.fontSize, fontWeight: '800' },

  deleteBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    justifyContent: 'center',
    paddingVertical: 10, borderRadius: Tokens.radius.md, marginTop: 8,
    borderColor: Colors.errorLight, borderWidth: 1,
  },
  deleteBtnText: { color: t.danger, fontSize: Type.footnote.fontSize, fontWeight: '700' },

  backLink: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingVertical: 4 },
  backLinkText: { color: t.accent, fontSize: Type.footnote.fontSize, fontWeight: '600' },
  emptyHint: { color: t.textSecondary, fontSize: Type.footnote.fontSize, padding: 20, textAlign: 'center' },

  photoTile: { width: 80, height: 80, borderRadius: Tokens.radius.sm, overflow: 'hidden', backgroundColor: t.surfaceAlt },
  photoTileImg: { width: '100%', height: '100%' },

  punchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: t.surfaceAlt, padding: 10, borderRadius: Tokens.radius.md, marginBottom: 6,
  },
  punchRowTitle: { color: t.text, fontSize: Type.footnote.fontSize, fontWeight: '600' },
  punchRowSub: { color: t.textSecondary, fontSize: Type.caption2.fontSize, marginTop: 2 },
});
