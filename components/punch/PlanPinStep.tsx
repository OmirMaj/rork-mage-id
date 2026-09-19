// components/punch/PlanPinStep.tsx — "Where is this?" The pin step of the
// punch walk: photo, then PIN, then description (founder, 2026-09-17, on a
// real walk).
//
// WHAT IT DOES. Full screen, opened by app/punch-walk.tsx straight after the
// camera returns. The project's plan fills the screen; he taps where the photo
// was taken, and "Next" hands the pin back to the draft form. "Skip" hands back
// nothing, and the item saves exactly as it did before this step existed.
//
// THE PIN LANDS WHERE PLAN-VIEWER WILL DRAW IT. Every coordinate decision is in
// utils/punchPlanPin.ts (executed by scripts/validate-punch-plan-pin.ts): the
// pin is normalised against the rendered IMAGE rect — a box sized to the
// `contain`-fitted plan — never the letterboxed container. The ratio comes from
// the loaded image first (its onLoad size is the pixels actually drawn); the
// sheet's stored width/height stands in only until that arrives, so the box is
// right before AND after a late load. Same order as planViewerImageRatio.
//
// TOUCH. One responder on the image box, and every child of that box is
// pointerEvents="none" — a touch's locationX is relative to the view it lands
// on, and a finger sliding onto the marker or the image would otherwise start
// reporting coordinates relative to THAT child and fling the pin to the corner.
//   • a tap anywhere drops (or re-drops) the pin on release;
//   • a touch that starts on the pin drags it, and while it does the
//     ScrollView neither scrolls nor may take the responder away;
//   • a pinch or pan the native ScrollView claims terminates the responder,
//     and a terminated touch drops nothing — zooming must never move the pin.
// No reanimated or gesture-handler: this ships over OTA.
//
// NO PLAN. On the founder's jobs today the only sheet ("IMG_1668") has an
// empty image. So the step never assumes a plan: no sheet → say so and offer
// "Add a floor plan"; a sheet with no image → offer to add the image to THAT
// sheet (its id and any pins survive). Both go through utils/addFloorPlan,
// which uploads before it creates anything — a plan added here is visible on
// every phone, or it is not added and the reason is on screen. Skip is always
// there.
//
// ONLY ON THIS PHONE. A sheet whose image is a file:// on this phone and ''
// in Postgres (an old Import-image sheet — the founder's IMG_1668 on the phone
// that imported it) renders here and nowhere else. Pinning on it would file
// the defect against a plan the office and the subs see as blank, so the step
// shows the plan but asks him to SAVE it first (uploadDeviceOnlyFloorPlan —
// same sheet id, so anything already on it survives). If the file is gone, or
// is a HEIC/oversize original the plan store will not take, "Try again" can
// never help (there is no storage path to re-sign), so the step offers to
// photograph or pick the plan again INTO THE SAME SHEET (pinStepSheetMode).
//
// OFFLINE. A stored plan is loaded through expo-image with a disk cache keyed
// by its STORAGE PATH, not its URL: the URL is a 24 h signed link that
// ProjectContext re-mints, and a URL-keyed cache entry is orphaned the moment
// it does. After an app restart with no signal ProjectContext hands over the
// bare path as imageUri — not a URL at all — so pinStepImageSource
// (utils/punchPlanPin, executed by the validator) always attaches the path key
// and always gives expo-image a valid URL, which is what makes it look in the
// disk cache first. A plan that has loaded on this phone once keeps opening in
// a basement; one that never has cannot, and the error says exactly that.
//
// PIN ITEMS / PIN FIRST / EDIT SHEET (founder, 2026-09-18: "pin the location of
// each item before and after taking photos"). The same step now also serves:
//   • app/punch-pin.tsx — presentation="screen", ONE mounted body walked item
//     to item. `itemKey` resets the item-scoped state during render (no frame
//     shows item A's pin under item B's card) while the ScrollView — and so
//     the iOS zoom and scroll, the loaded image and its re-signed link — stays
//     put when the next item is on the same sheet;
//   • Walk Mode's pin-first mode (title/labels only);
//   • the punch list edit sheet (Pin on plan / Move pin, nested in its Modal).
// Every new prop defaults to exactly what the walk had before. The geometry is
// untouched: this file is still the one place a tap becomes a pin.

import React, { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Modal, Platform, ActivityIndicator,
  type GestureResponderEvent, type LayoutChangeEvent,
} from 'react-native';
import { Image as ExpoImage, type ImageLoadEventData } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { X, MapPin, ClipboardList, Camera, ImagePlus, RotateCcw, FileImage, CloudUpload, FileText } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useProjects } from '@/contexts/ProjectContext';
import { useProjectRoleState } from '@/hooks/useProjectRole';
import { SUPABASE_URL } from '@/lib/supabase';
import { resolvePlanSheetUrl } from '@/utils/planSheetUrls';
import { Button } from '@/components/ui';
import type { PlanSheet } from '@/types';
import { addFloorPlan, attachFloorPlanImage, uploadDeviceOnlyFloorPlan, type FloorPlanActions } from '@/utils/addFloorPlan';
import { pickFloorPlanImage } from '@/utils/pickFloorPlanImage';
import { planSheetImageState, type FloorPlanFailure } from '@/utils/planSheetImageCore';
import {
  PIN_MARKER_SIZE,
  containImageRect,
  isDurablePinSheet,
  isTouchOnPin,
  normalizeTapToImage,
  offerablePinSheets,
  pinMarkerPosition,
  pinSheetLabel,
  pinStepImageSource,
  pickInitialPinSheet,
  pinStepSheetMode,
  pinsOnSheet,
  planUploadBlockedReason,
  sheetAspectRatio,
  type BoxSize,
  type NormalizedPoint,
  type WalkPin,
} from '@/utils/punchPlanPin';

export interface PlanPinStepProps {
  visible: boolean;
  projectId: string;
  /** The photo just taken — shown small in the header so he knows what he is pinning. */
  photoUri?: string;
  /** The draft's current pin, when re-opened from "Pinned on …" to change it. */
  initialPin?: WalkPin | null;
  /** The sheet the last pin of THIS walk went on. */
  sessionSheetId?: string | null;
  /** Items saved this walk, drawn a little stronger than older pins. */
  sessionItemIds: readonly string[];
  onNext: (pin: WalkPin, sheetLabel: string) => void;
  /**
   * `hadPlan` false = he skipped a screen with nothing to pin on: no sheet at
   * all, or only sheets with no image saved. The walk mutes auto-open for that.
   */
  onSkip: (ctx: { hadPlan: boolean }) => void;
  /** Close/back: the walk keeps its photo and whatever pin it already had. */
  onClose: () => void;

  // ── Optional (Pin items, Pin first, the edit sheet). Defaults = the walk. ──
  /** 'screen' renders inline (Pin items); 'modal' is the walk's full-screen Modal. */
  presentation?: 'modal' | 'screen';
  /** The Modal finished closing (iOS / web). Pin first parks the camera on it. */
  onDismissed?: () => void;
  title?: string;
  /** Accessibility label of the header X. */
  closeLabel?: string;
  /** Header subtitle becomes `${subtitlePrefix} · ${sheet}`. */
  subtitlePrefix?: string;
  /** A thin bar along the header's bottom edge. */
  progress?: { value: number; max: number };
  /** The ENABLED Next label; the blocked reasons after it are unchanged. */
  nextLabel?: string;
  skipLabel?: string;
  /** Used in the canvas's screen-reader hints. */
  skipHint?: string;
  /** Between the header and the sheet switcher (Pin items' photo strip). */
  topSlot?: ReactNode;
  /** When set, the middle becomes a row: this on the left, the plan on the right. */
  sidePane?: ReactNode;
  /** First children of the Skip / Next row (Back + Undo). */
  footerLeading?: ReactNode;
  onFooterLayout?: (height: number) => void;
  showHint?: boolean;
  /** Web only: Enter saves, S skips, ← back, Ctrl/Cmd+Z undo. */
  webShortcuts?: { onBack?: () => void; onUndo?: () => void } | null;
  /** Changing it resets the item-scoped state (pin, errors, drag) without a remount. */
  itemKey?: string;
  /** The sheet to open on when there is no initialPin (an item filed to a sheet with no spot). */
  initialSheetId?: string | null;
  /** Items not drawn as faint existing pins (the one being moved). */
  hideItemIds?: readonly string[];
  /** Adds "Import a PDF plan set" to the no-plan and imageless panels. */
  onImportPdf?: () => void;
  importPdfBlockedReason?: string | null;
}

type LoadState = 'loading' | 'loaded' | 'error';

const NO_IDS: readonly string[] = [];
// Android fires no onDismiss (RN 0.81, iOS only), so the closing body is let go after this.
const CLOSING_MAX_MS = 700;

export default function PlanPinStep(props: PlanPinStepProps) {
  const { visible, onClose, presentation = 'modal', onDismissed } = props;
  // Every false→true edge of `visible` is a new open with a fresh body (its
  // state starts from the props, not from the previous photo). A true→false
  // edge keeps the body drawn until the Modal has finished sliding away —
  // unmounting it at once slid a blank (white in dark mode) sheet down after
  // every pin of every walk.
  const [openSeq, setOpenSeq] = useState(visible ? 1 : 0);
  const [seenVisible, setSeenVisible] = useState(visible);
  const [closing, setClosing] = useState(false);
  if (visible !== seenVisible) {
    setSeenVisible(visible);
    if (visible) { setOpenSeq(n => n + 1); setClosing(false); } else setClosing(true);
  }
  useEffect(() => {
    if (!closing) return;
    const t = setTimeout(() => setClosing(false), CLOSING_MAX_MS);
    return () => clearTimeout(t);
  }, [closing]);
  const handleDismiss = useCallback(() => {
    setClosing(false);
    onDismissed?.();
  }, [onDismissed]);

  if (presentation === 'screen') return visible ? <PlanPinStepBody {...props} /> : null;
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose} onDismiss={handleDismiss}>
      {visible || closing ? (
        // Taps are off while it closes, so a second tap on Next cannot submit twice.
        <View style={{ flex: 1 }} pointerEvents={visible ? 'auto' : 'none'}>
          <PlanPinStepBody key={openSeq} {...props} />
        </View>
      ) : null}
    </Modal>
  );
}

// In the modal the body mounts fresh on every open (keyed by the open
// sequence), so its state starts from the props each time instead of carrying
// a pin from the previous photo. Inline (Pin items) it stays mounted and
// `itemKey` resets the item-scoped state instead.
function PlanPinStepBody({
  projectId, photoUri, initialPin, sessionSheetId, sessionItemIds, onNext, onSkip, onClose,
  title = 'Where is this?',
  closeLabel = 'Back to the walk, keep the photo',
  subtitlePrefix,
  progress,
  nextLabel = 'Next',
  skipLabel = 'Skip',
  skipHint = 'Skip to save without a pin',
  topSlot,
  sidePane,
  footerLeading,
  onFooterLayout,
  showHint = true,
  webShortcuts,
  itemKey,
  initialSheetId = null,
  hideItemIds = NO_IDS,
  onImportPdf,
  importPdfBlockedReason = null,
}: PlanPinStepProps) {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { getPlanSheetsForProject, punchItems, addPlanSheet, updatePlanSheet } = useProjects();
  const roleState = useProjectRoleState(projectId);

  // addFloorPlan resolves the context actions AFTER its upload await — the ones
  // captured by this render would persist a stale sheet list (see its header).
  const actionsRef = useRef<FloorPlanActions>({ addPlanSheet, updatePlanSheet });
  actionsRef.current = { addPlanSheet, updatePlanSheet };

  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const allSheets = getPlanSheetsForProject(projectId);
  // A sheet added a moment ago may not be in the context list on this render.
  const [justAdded, setJustAdded] = useState<PlanSheet | null>(null);
  const sheets = useMemo(() => {
    const keep = initialPin?.sheetId ?? initialSheetId;
    const offer = offerablePinSheets(allSheets, projectId, keep);
    if (justAdded && !offer.some(s => s.id === justAdded.id)) return [justAdded, ...offer];
    return offer;
  }, [allSheets, projectId, initialPin?.sheetId, initialSheetId, justAdded]);

  const [sheetId, setSheetId] = useState<string | null>(() =>
    pickInitialPinSheet({ sheets: allSheets, projectId, initialPin, initialSheetId, sessionSheetId, punchItems }));
  const listed = sheets.find(s => s.id === sheetId) ?? null;
  // A sheet saved a moment ago (device-only → uploaded, or an image attached)
  // may still be the old object in the context list on this render; the saved
  // copy carries the storage path, and dropping back to the old one for a
  // render would flash the save prompt again.
  const sheet = listed && justAdded && justAdded.id === listed.id && !listed.storagePath && justAdded.storagePath
    ? { ...listed, ...justAdded }
    : listed;
  const imageState = sheet ? planSheetImageState(sheet) : 'missing';

  const [pin, setPin] = useState<NormalizedPoint | null>(() =>
    initialPin && initialPin.sheetId === sheetId ? { x: initialPin.x, y: initialPin.y } : null);

  // Opened before the plan sheets hydrated (pin first on mount, a cold
  // /punch-pin link), the step chose "no sheet" once and sat on "No floor
  // plan" for good. Latch the first sheet that turns up.
  const latch = sheetId ? null : pickInitialPinSheet({ sheets: allSheets, projectId, initialPin, initialSheetId, sessionSheetId, punchItems });
  useEffect(() => {
    if (!latch) return;
    setSheetId(latch);
    if (initialPin?.sheetId === latch) setPin({ x: initialPin.x, y: initialPin.y });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latch]);

  const [container, setContainer] = useState<BoxSize | null>(null);
  const [loadedRatio, setLoadedRatio] = useState<number | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [reloadKey, setReloadKey] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState<'camera' | 'library' | 'save' | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  // Why saving a device-only sheet failed, for THAT sheet. The kind decides
  // whether the step keeps offering "Save" (no signal: try again later) or
  // moves to re-picking (the file is gone or unusable).
  const [saveFailure, setSaveFailure] = useState<{ sheetId: string; kind: FloorPlanFailure; reason: string } | null>(null);
  // A freshly signed URL for the current sheet, minted on "Try again" or when
  // the sheet arrived with a bare path / expired link. Cleared on sheet change.
  const [resigned, setResigned] = useState<{ sheetId: string; uri: string } | null>(null);

  // A new item in Pin items: reset what belongs to the item, during render
  // (React's "adjust state when a prop changes"), so no frame ever shows the
  // last item's pin under this item's card. The sheet only changes when this
  // item is seeded somewhere else — on the same sheet the ScrollView (and the
  // iOS zoom, the loaded image, the re-signed link) carries straight over.
  const [seenItemKey, setSeenItemKey] = useState(itemKey);
  if (itemKey !== seenItemKey) {
    setSeenItemKey(itemKey);
    const next = pickInitialPinSheet({ sheets: allSheets, projectId, initialPin, initialSheetId, sessionSheetId: sheetId ?? sessionSheetId, punchItems });
    if (next !== sheetId) { setSheetId(next); setLoadedRatio(null); setLoadState('loading'); setSaveFailure(null); setResigned(null); }
    setPin(initialPin && initialPin.sheetId === next ? { x: initialPin.x, y: initialPin.y } : null);
    setAddError(null);
    setDragging(false);
  }

  // The loaded image's own shape wins; the stored width/height only sizes the
  // box before the image arrives. Stored dimensions can be wrong (some Android
  // pickers swap them for EXIF-rotated shots; a legacy row may describe another
  // image), and a box of the wrong shape normalises every tap against a
  // rectangle that is not the drawing. Pinning waits for 'loaded' anyway.
  const ratio = loadedRatio ?? sheetAspectRatio(sheet);
  const rect = useMemo(() => containImageRect(container, ratio), [container, ratio]);
  const box = useMemo<BoxSize | null>(() => (rect ? { w: rect.w, h: rect.h } : null), [rect]);
  const sheetSaveFailure = saveFailure && sheet && saveFailure.sheetId === sheet.id ? saveFailure : null;
  const mode = pinStepSheetMode({ imageState, loadState, saveFailure: sheetSaveFailure?.kind ?? null });
  // Only a durable plan takes a pin: see ONLY ON THIS PHONE in the header.
  const canPin = !!sheet && mode === 'pin' && loadState === 'loaded' && !!box;

  const existing = useMemo(
    () => pinsOnSheet(punchItems, projectId, sheetId, sessionItemIds, hideItemIds),
    [punchItems, projectId, sheetId, sessionItemIds, hideItemIds],
  );

  // VoiceOver/TalkBack cannot aim a tap: a double-tap lands on the element's
  // centre. So the screen-reader path drops the pin in the middle of the plan
  // (Next becomes available) and says so; a sighted helper can drag it after.
  const handleAccessibilityPin = useCallback(() => {
    if (!canPin) return;
    setPin(prev => prev ?? { x: 0.5, y: 0.5 });
  }, [canPin]);

  const handleContainerLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setContainer(prev => (prev && prev.w === width && prev.h === height ? prev : { w: width, h: height }));
  }, []);

  const switchSheet = useCallback((id: string) => {
    if (id === sheetId) return;
    setSheetId(id);
    // A pin is a point on ONE drawing; carried to another sheet it would be a
    // confident marker in the wrong room.
    setPin(null);
    setLoadedRatio(null);
    setLoadState('loading');
    setAddError(null);
    setSaveFailure(null);
    setResigned(null);
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, [sheetId]);

  // ── Touch ────────────────────────────────────────────────────────────────
  const touchRef = useRef<{ onPin: boolean; moved: boolean }>({ onPin: false, moved: false });
  // Refs are not written during render: the item reset above clears the touch here.
  useEffect(() => { touchRef.current = { onPin: false, moved: false }; }, [itemKey]);
  // RN-web measures locationX/Y against whatever DOM node is under the pointer,
  // not the responder: dragged past the plan's edge onto the letterbox or the
  // scroll content, the same numbers would mean a different box and the pin
  // would jump. On web a move/release that is not ON the image box is ignored
  // (the box's children are pointerEvents="none", so over the plan the target
  // is always the box itself). Native reports locationX against the responder.
  const boxRef = useRef<View>(null);
  const isOffBoxOnWeb = useCallback((e: GestureResponderEvent) => {
    if (Platform.OS !== 'web' || !boxRef.current) return false;
    return (e.nativeEvent.target as unknown) !== (boxRef.current as unknown);
  }, []);

  const endTouch = useCallback(() => {
    touchRef.current = { onPin: false, moved: false };
    setDragging(false);
  }, []);

  const handleGrant = useCallback((e: GestureResponderEvent) => {
    const { locationX, locationY } = e.nativeEvent;
    const onPin = isTouchOnPin(locationX, locationY, pin, box);
    touchRef.current = { onPin, moved: false };
    if (onPin) setDragging(true);
  }, [pin, box]);

  const handleMove = useCallback((e: GestureResponderEvent) => {
    if (!touchRef.current.onPin || isOffBoxOnWeb(e)) return;
    const next = normalizeTapToImage(e.nativeEvent.locationX, e.nativeEvent.locationY, box);
    if (!next) return;
    touchRef.current.moved = true;
    setPin(next);
  }, [box, isOffBoxOnWeb]);

  const handleRelease = useCallback((e: GestureResponderEvent) => {
    const { onPin, moved } = touchRef.current;
    endTouch();
    // A drag already moved the pin; a press on the pin without moving leaves it
    // where it is. Anything else is a tap that drops the pin right there.
    if (moved || onPin || isOffBoxOnWeb(e)) return;
    const next = normalizeTapToImage(e.nativeEvent.locationX, e.nativeEvent.locationY, box);
    if (!next) return;
    setPin(next);
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [box, endTouch, isOffBoxOnWeb]);

  // ── Adding a plan ────────────────────────────────────────────────────────
  // The plan-sheets insert policy requires editor access. Anyone below that —
  // viewer, field, or a role that has not resolved — is told before he picks a
  // photo, not after an upload is refused (planUploadBlockedReason).
  const uploadBlockedReason = planUploadBlockedReason(roleState.role, roleState);

  const runAdd = useCallback(async (source: 'camera' | 'library') => {
    if (uploadBlockedReason || busy) return;
    setAddError(null);
    setBusy(source);
    try {
      const picked = await pickFloorPlanImage(source);
      if (picked.status === 'canceled') return;
      if (picked.status === 'blocked') { if (mountedRef.current) setAddError(picked.reason); return; }
      // A listed sheet with no DURABLE image (none at all, or only a file on
      // this phone that is gone or unusable) gets its image — same id, so
      // anything already pinned to it stays pinned. No sheet gets a new one.
      const result = sheet && imageState !== 'durable'
        ? await attachFloorPlanImage(sheet, picked.image, () => actionsRef.current)
        // A camera capture's file name is a device UUID on Android ("3f2a9c1e-…"),
        // which would read as the sheet name on the pin chip and the roll-up. A
        // library pick keeps its file name — that is often the plan's real name.
        : await addFloorPlan(
          source === 'camera'
            ? { projectId, image: picked.image, name: 'Floor plan' }
            : { projectId, image: picked.image },
          () => actionsRef.current,
        );
      if (!mountedRef.current) return;
      if (!result.ok) { setAddError(result.reason); return; }
      setJustAdded(result.sheet);
      setSheetId(result.sheet.id);
      setPin(null);
      setLoadedRatio(null);
      setLoadState('loading');
      setSaveFailure(null);
      setResigned(null);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } finally {
      if (mountedRef.current) setBusy(null);
    }
  }, [uploadBlockedReason, busy, sheet, imageState, projectId]);

  // "Save it" for a device-only sheet: upload the file this phone already has.
  // Same image, so the rendered plan and its measured ratio stay as they are.
  const runSaveDeviceOnly = useCallback(async () => {
    if (!sheet || imageState !== 'device-only' || uploadBlockedReason || busy) return;
    setSaveFailure(null);
    setBusy('save');
    try {
      const result = await uploadDeviceOnlyFloorPlan(sheet, () => actionsRef.current);
      if (!mountedRef.current) return;
      if (!result.ok) { setSaveFailure({ sheetId: sheet.id, kind: result.kind, reason: result.reason }); return; }
      setJustAdded(result.sheet);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } finally {
      if (mountedRef.current) setBusy(null);
    }
  }, [sheet, imageState, uploadBlockedReason, busy]);

  // ── Image ────────────────────────────────────────────────────────────────
  const resignedUri = resigned && resigned.sheetId === sheet?.id ? resigned.uri : null;
  const imageSource = useMemo(
    () => pinStepImageSource(sheet, { publicBaseUrl: SUPABASE_URL, resignedUri }),
    [sheet, resignedUri],
  );

  // Mint a fresh signed URL for the sheet's storage path. Never throws:
  // resolvePlanSheetUrl hands the path back unchanged when it cannot sign
  // (offline), and then the path-keyed cache is all there is.
  const resign = useCallback(async (target: PlanSheet) => {
    if (!target.storagePath) return;
    const uri = await resolvePlanSheetUrl(target.storagePath);
    if (mountedRef.current && /^https?:\/\//i.test(uri)) setResigned({ sheetId: target.id, uri });
  }, []);

  // A sheet that reached us as a bare path (cold start before ProjectContext
  // re-signed) gets a real link when there is signal. A cache hit renders
  // first anyway; this only matters for a plan this phone has never loaded.
  // (It fell through to the path-built URL: no signed link, no local file.)
  const sheetNeedsLink = !!sheet?.storagePath && !resignedUri && !!imageSource && imageSource.uri !== sheet.imageUri;
  const sheetRef = useRef(sheet);
  sheetRef.current = sheet;
  useEffect(() => {
    // Keyed on the sheet id, not the sheet object: the context list rebuilds its
    // objects on every render, and an offline re-sign per render is a request
    // storm for nothing.
    if (sheetNeedsLink && sheetRef.current) void resign(sheetRef.current);
  }, [sheet?.id, sheetNeedsLink, resign]);

  const handleRetry = useCallback(() => {
    setLoadState('loading');
    setReloadKey(k => k + 1);
    // Retrying the same 24 h link can never succeed once it has expired — the
    // retry re-signs from the storage path, under the same cache key.
    if (sheet) void resign(sheet);
  }, [sheet, resign]);

  const handleImageLoad = useCallback((e: ImageLoadEventData) => {
    const s = e?.source;
    if (s?.width && s?.height) setLoadedRatio(s.width / s.height);
    setLoadState('loaded');
  }, []);

  const handleImageError = useCallback(() => setLoadState('error'), []);

  const handleNext = useCallback(() => {
    if (!sheet || !pin) return;
    onNext({ sheetId: sheet.id, x: pin.x, y: pin.y }, pinSheetLabel(sheet));
  }, [sheet, pin, onNext]);

  // "Had a plan" means a plan he could pin on. Only imageless sheets is the
  // same situation as no sheet, and Skip mutes it for the walk just the same.
  // A device-only sheet counts as NO plan here, matching the walk's
  // durablePinSheetCount: skipping its save prompt mutes auto-open for the walk
  // instead of bringing the prompt back after every photo.
  const hadPinnablePlan = sheets.some(isDurablePinSheet);
  const handleSkip = useCallback(() => onSkip({ hadPlan: hadPinnablePlan }), [onSkip, hadPinnablePlan]);

  // ── Web keys (Pin items on a laptop) ─────────────────────────────────────
  // Read through a ref so the listener registers once, never with a stale pin.
  const keyStateRef = useRef({ canNext: false, handleNext, handleSkip, hadPinnablePlan, webShortcuts });
  keyStateRef.current = { canNext: !!pin && canPin, handleNext, handleSkip, hadPinnablePlan, webShortcuts };
  const shortcutsOn = !!webShortcuts && Platform.OS === 'web';
  useEffect(() => {
    if (!shortcutsOn || Platform.OS !== 'web' || typeof document === 'undefined') return;
    const onKey = (e: KeyboardEvent) => {
      // A held key auto-repeats: held Cmd+Z undid write after write, and a
      // held Enter saved the next item's pin before he had placed it.
      if (e.defaultPrevented || e.isComposing || e.repeat) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return;
      const k = keyStateRef.current;
      const plain = !e.metaKey && !e.ctrlKey && !e.altKey;
      if (e.key === 'Enter' && plain && !e.shiftKey) {
        if (!k.canNext) return;
        e.preventDefault();
        k.handleNext();
      } else if ((e.key === 's' || e.key === 'S') && plain) {
        // Only with a plan showing: S must never be a way out of the flow.
        if (!k.hadPinnablePlan) return;
        e.preventDefault();
        k.handleSkip();
      } else if (e.key === 'ArrowLeft' && plain && k.webShortcuts?.onBack) {
        e.preventDefault();
        k.webShortcuts.onBack();
      } else if ((e.key === 'z' || e.key === 'Z') && (e.metaKey || e.ctrlKey) && !e.shiftKey && k.webShortcuts?.onUndo) {
        e.preventDefault();
        k.webShortcuts.onUndo();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [shortcutsOn]);

  const label = sheet ? pinSheetLabel(sheet) : null;
  const isWeb = Platform.OS === 'web';
  const hint = !canPin
    ? null
    : pin
      ? (isWeb ? 'Click somewhere else or drag the pin to move it.' : 'Drag the pin or tap somewhere else to move it.')
      : (isWeb ? 'Click the plan where this is.' : 'Tap the plan where this is. Pinch to zoom.');

  // ── Render ───────────────────────────────────────────────────────────────
  const renderAddButtons = (verb: string, opts?: { pdf?: boolean }) => (
    <View style={styles.addButtons}>
      {!isWeb && (
        <Button
          label={`Photograph ${verb}`}
          onPress={() => void runAdd('camera')}
          loading={busy === 'camera'}
          disabled={!!uploadBlockedReason || (busy !== null && busy !== 'camera')}
          iconLeft={<Camera size={16} color={Colors.textOnAccent} strokeWidth={2} />}
          fullWidth
          testID="walk-pin-add-camera"
        />
      )}
      {!isWeb && (
        <Text style={styles.panelNote}>Stand over the sheet with the phone flat, fill the frame, keep glare off it.</Text>
      )}
      <Button
        label={isWeb ? `Choose ${verb} image` : 'Pick from photos'}
        variant={isWeb ? 'primary' : 'secondary'}
        onPress={() => void runAdd('library')}
        loading={busy === 'library'}
        disabled={!!uploadBlockedReason || (busy !== null && busy !== 'library')}
        iconLeft={<ImagePlus size={16} color={isWeb ? Colors.textOnAccent : t.text} strokeWidth={2} />}
        fullWidth
        testID="walk-pin-add-library"
      />
      {opts?.pdf && onImportPdf && (
        <>
          <Button
            label="Import a PDF plan set"
            variant="secondary"
            onPress={onImportPdf}
            disabled={!!uploadBlockedReason || !!importPdfBlockedReason || busy !== null}
            iconLeft={<FileText size={16} color={t.text} strokeWidth={2} />}
            fullWidth
            testID="walk-pin-add-pdf"
          />
          <Text style={styles.panelNote}>Adds its pages as new sheets on the Plans screen.</Text>
          {importPdfBlockedReason && !uploadBlockedReason && <Text style={styles.panelWarn}>{importPdfBlockedReason}</Text>}
        </>
      )}
      {(busy === 'camera' || busy === 'library') && <Text style={styles.panelNote}>Uploading the plan so every phone and the office can see it{'…'}</Text>}
      {sheetSaveFailure && <Text style={styles.panelWarn} testID="walk-pin-save-error">{sheetSaveFailure.reason}</Text>}
      {uploadBlockedReason && <Text style={styles.panelWarn} testID="walk-pin-add-blocked">{uploadBlockedReason}</Text>}
      {addError && <Text style={styles.panelWarn} testID="walk-pin-add-error">{addError}</Text>}
    </View>
  );

  let body: React.ReactNode;
  if (!sheet) {
    // A ScrollView, not a View: under Pin items' photo strip on an iPhone SE
    // the buttons, notes and any warning are taller than the space left, and
    // a plain View spilled them over the strip and under the footer.
    body = (
      <ScrollView style={styles.panelWrap} contentContainerStyle={styles.panel} testID="walk-pin-no-plan">
        <FileImage size={28} color={t.textMuted} strokeWidth={1.75} />
        <Text style={styles.panelTitle}>No floor plan on this job yet</Text>
        <Text style={styles.panelBody}>
          Add one to pin where each item is. A photo of the paper plan on the wall works. It saves to the job, so the office and your subs see the same pins.
        </Text>
        {renderAddButtons('the plan', { pdf: true })}
      </ScrollView>
    );
  } else if (imageState === 'missing') {
    // Sheets he CAN pin on (a PDF he just imported, say) sit in the chips
    // above, but this panel stays on the imageless sheet it opened on — say so.
    const otherPinnable = sheets.filter(s => s.id !== sheet.id && isDurablePinSheet(s)).length;
    body = (
      <ScrollView style={styles.panelWrap} contentContainerStyle={styles.panel} testID="walk-pin-sheet-missing">
        <FileImage size={28} color={t.warningLabel} strokeWidth={1.75} />
        <Text style={styles.panelTitle}>{label} has no image saved</Text>
        <Text style={styles.panelBody}>
          The plan was added without its picture, so there is nothing to pin on. Add the image to this sheet and it keeps its name and any pins already on it.
        </Text>
        {otherPinnable > 0 && (
          <Text style={styles.panelBody} testID="walk-pin-other-sheets">
            {otherPinnable === 1 ? 'Another sheet has its image' : `${otherPinnable} other sheets have their image`} {'—'} tap {otherPinnable === 1 ? 'it' : 'one'} in the sheet list above to pin there.
          </Text>
        )}
        {renderAddButtons('the plan', { pdf: true })}
      </ScrollView>
    );
  } else {
    const marker = pin && box ? pinMarkerPosition(pin, box) : null;
    body = (
      <View style={styles.canvasWrap} onLayout={handleContainerLayout}>
        {container && imageSource ? (
          <ScrollView
            // Remounted per sheet so a new plan opens fitted, not at the last zoom.
            key={`${sheet.id}-${reloadKey}`}
            maximumZoomScale={Platform.OS === 'ios' ? 4 : 1}
            minimumZoomScale={1}
            pinchGestureEnabled={Platform.OS === 'ios'}
            bouncesZoom
            // Best effort: the prop lands a render after the grant, so on a zoomed
            // plan the native pan can still win a fast drag and end it. Tapping
            // elsewhere always re-drops the pin, which the hint says.
            scrollEnabled={!dragging}
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
            style={StyleSheet.absoluteFill}
            contentContainerStyle={[styles.canvasContent, { width: container.w, height: container.h }]}
          >
            <View
              ref={boxRef}
              style={rect ? { width: rect.w, height: rect.h } : { width: container.w, height: container.h }}
              onStartShouldSetResponder={() => canPin}
              onMoveShouldSetResponder={() => touchRef.current.onPin}
              onResponderTerminationRequest={() => !touchRef.current.onPin}
              onResponderGrant={handleGrant}
              onResponderMove={handleMove}
              onResponderRelease={handleRelease}
              onResponderTerminate={endTouch}
              accessible
              accessibilityRole="image"
              accessibilityLabel={`Floor plan ${label}${pin ? ', pin placed' : ''}`}
              accessibilityHint={pin
                ? `Pin placed. Use ${nextLabel} to continue, or ${skipHint}.`
                : `Double-tap to drop a pin in the middle of the plan, or ${skipHint}.`}
              accessibilityActions={[{ name: 'activate', label: 'Drop pin in the middle of the plan' }]}
              onAccessibilityAction={e => { if (e.nativeEvent.actionName === 'activate') handleAccessibilityPin(); }}
              onAccessibilityTap={handleAccessibilityPin}
              testID="walk-pin-canvas"
            >
              <View style={StyleSheet.absoluteFill} pointerEvents="none">
                <ExpoImage
                  source={imageSource}
                  style={StyleSheet.absoluteFill}
                  contentFit="contain"
                  cachePolicy="memory-disk"
                  onLoad={handleImageLoad}
                  onError={handleImageError}
                  transition={0}
                />
              </View>

              {/* What is already logged on this sheet — faint, so the new pin
                  is the only thing that reads as "this one". */}
              {box && loadState === 'loaded' && existing.map(p => {
                const pos = pinMarkerPosition(p, box);
                return (
                  <View
                    key={p.id}
                    pointerEvents="none"
                    style={[
                      styles.marker,
                      styles.markerExisting,
                      // Strong enough to read in sunlight; the placed pin is still the only red one.
                      { left: pos.left, top: pos.top, opacity: p.fromThisWalk ? 0.85 : 0.6 },
                    ]}
                  >
                    <ClipboardList size={13} color={Colors.textOnAccent} strokeWidth={2.5} />
                  </View>
                );
              })}

              {marker && (
                <View
                  pointerEvents="none"
                  style={[styles.marker, styles.markerPlaced, { left: marker.left, top: marker.top }]}
                  testID="walk-pin-marker"
                >
                  <MapPin size={15} color={Colors.textOnAccent} strokeWidth={2.5} />
                </View>
              )}
            </View>
          </ScrollView>
        ) : null}

        {loadState === 'loading' && (
          <View style={styles.canvasOverlay} pointerEvents="none">
            <ActivityIndicator color={t.textMuted} />
          </View>
        )}
        {mode === 'save' && (
          <View style={styles.saveBanner} testID="walk-pin-device-only">
            <Text style={styles.saveBannerTitle}>This plan is only on this phone</Text>
            <Text style={styles.saveBannerBody}>
              The office and your subs see a blank sheet. Save it to the job, then pin {'—'} anything already on it stays.
            </Text>
            <Button
              label="Save plan to the job"
              onPress={() => void runSaveDeviceOnly()}
              loading={busy === 'save'}
              disabled={!!uploadBlockedReason || (busy !== null && busy !== 'save')}
              iconLeft={<CloudUpload size={16} color={Colors.textOnAccent} strokeWidth={2} />}
              fullWidth
              testID="walk-pin-save-device-only"
            />
            {uploadBlockedReason && <Text style={styles.panelWarn}>{uploadBlockedReason}</Text>}
            {sheetSaveFailure && <Text style={styles.panelWarn} testID="walk-pin-save-error">{sheetSaveFailure.reason}</Text>}
          </View>
        )}
        {mode === 'repick' && (
          <View style={[styles.canvasOverlay, styles.canvasOverlaySolid]} testID="walk-pin-device-only-repick">
            <FileImage size={28} color={t.warningLabel} strokeWidth={1.75} />
            <Text style={styles.panelTitle}>{label} needs its image again</Text>
            <Text style={styles.panelBody}>
              {loadState === 'error'
                ? 'This plan was only ever on this phone, and the file is gone. Add the image again and it keeps its name and any pins already on it.'
                : 'This plan is only on this phone, and its file can\u2019t be saved to the job. Add the image again and it keeps its name and any pins already on it.'}
            </Text>
            {renderAddButtons('the plan')}
          </View>
        )}
        {mode === 'pin' && loadState === 'error' && (
          <View style={[styles.canvasOverlay, styles.canvasOverlaySolid]} testID="walk-pin-load-error">
            <Text style={styles.panelTitle}>Plan can{'’'}t load</Text>
            <Text style={styles.panelBody}>
              {Platform.OS === 'web'
                ? 'No signal, or the link to it expired. Skip the pin, or try again when you have signal.'
                : 'No signal, or the link to it expired. With no signal a plan only opens if it has already loaded on this phone. Skip the pin, or try again when you have signal.'}
            </Text>
            <Button
              label="Try again"
              variant="secondary"
              onPress={handleRetry}
              iconLeft={<RotateCcw size={15} color={t.text} strokeWidth={2} />}
              testID="walk-pin-retry"
            />
          </View>
        )}
      </View>
    );
  }

  const subtitle = subtitlePrefix ? (label ? `${subtitlePrefix} · ${label}` : subtitlePrefix) : label;
  // With Back/Undo beside them (Pin items) the two buttons share ~230pt on a
  // 375pt phone: the default 24pt padding broke "Skip" inside the word. Same
  // 48pt height — only the side padding gives.
  const footerButtonPad = footerLeading ? { paddingHorizontal: 10 } : undefined;
  const shortcutHint = shortcutsOn ? ' Enter saves · S skips · ← back · Ctrl/Cmd+Z undo.' : '';

  const switcher = sheets.length > 1 ? (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.switcher}
      contentContainerStyle={styles.switcherRail}
    >
      {sheets.map(s => {
        const active = s.id === sheetId;
        return (
          <TouchableOpacity
            key={s.id}
            style={[styles.sheetChip, active && styles.sheetChipActive]}
            onPress={() => switchSheet(s.id)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`Plan ${pinSheetLabel(s)}`}
            testID={`walk-pin-sheet-${s.id}`}
          >
            <Text style={[styles.sheetChipText, active && styles.sheetChipTextActive]} numberOfLines={1}>
              {pinSheetLabel(s)}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  ) : null;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]} testID="walk-pin-step">
      <View>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={onClose}
            style={styles.headerBtn}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={closeLabel}
            testID="walk-pin-close"
          >
            <X size={20} color={t.text} strokeWidth={1.75} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.title} numberOfLines={1}>{title}</Text>
            {subtitle ? <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text> : null}
          </View>
          {photoUri ? <ExpoImage source={{ uri: photoUri }} style={styles.thumb} contentFit="cover" /> : null}
        </View>
        {progress && progress.max > 0 && (
          <View
            style={styles.progressTrack}
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel={`${progress.value} of ${progress.max} pinned`}
            accessibilityValue={{ min: 0, max: progress.max, now: progress.value }}
            testID="walk-pin-progress"
          >
            <View style={[styles.progressFill, { width: `${Math.max(0, Math.min(100, (progress.value / progress.max) * 100))}%` }]} />
          </View>
        )}
      </View>

      {sidePane ? (
        <View style={styles.paneRow}>
          {sidePane}
          <View style={{ flex: 1 }}>
            {switcher}
            <View style={{ flex: 1 }}>{body}</View>
          </View>
        </View>
      ) : (
        <>
          {topSlot}
          {switcher}
          <View style={{ flex: 1 }}>{body}</View>
        </>
      )}

      <View
        style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}
        onLayout={onFooterLayout ? (e: LayoutChangeEvent) => onFooterLayout(e.nativeEvent.layout.height) : undefined}
      >
        {hint && showHint && (
          <Text style={styles.hint}>
            {hint}
            {existing.length > 0 ? ` ${existing.length} item${existing.length === 1 ? '' : 's'} already pinned on this sheet.` : ''}
            {shortcutHint}
          </Text>
        )}
        <View style={styles.footerRow}>
          {footerLeading}
          <View style={{ flex: 1 }}>
            <Button label={skipLabel} variant="secondary" onPress={handleSkip} fullWidth style={footerButtonPad} testID="walk-pin-skip" />
          </View>
          {sheet && imageState !== 'missing' && (
            <View style={{ flex: 2 }}>
              <Button
                // The disabled button says what it is waiting for.
                label={pin && canPin
                  ? nextLabel
                  // Short: on a 375pt phone beside Back/Undo the long
                  // forms wrapped to three lines in a 48pt button and the
                  // reason was clipped. The panel above carries the detail.
                  : mode === 'save'
                    ? 'Save the plan first'
                    : mode === 'repick'
                      ? 'Add the plan image first'
                      : loadState === 'error'
                        ? 'Plan didn’t load'
                        : loadState === 'loading'
                          ? 'Loading the plan…'
                          : (isWeb ? 'Click the plan where this is' : 'Tap the plan where this is')}
                onPress={handleNext}
                disabled={!pin || !canPin}
                fullWidth
                style={footerButtonPad}
                testID="walk-pin-next"
              />
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: t.bg },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 12, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: t.line,
  },
  headerBtn: {
    width: 36, height: 36, borderRadius: Tokens.radius.xl, alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.surfaceAlt,
  },
  title: { ...Type.serifHeadline, color: t.text },
  progressTrack: { height: 3, backgroundColor: Colors.fillSecondary },
  progressFill: { height: 3, backgroundColor: t.accentFill },
  paneRow: { flex: 1, flexDirection: 'row' },
  subtitle: { fontSize: Type.caption1.fontSize, color: t.textSecondary, fontWeight: '600', marginTop: 1 },
  thumb: { width: 44, height: 44, borderRadius: Tokens.radius.sm, backgroundColor: Colors.fillSecondary },

  switcher: { flexGrow: 0, borderBottomWidth: 1, borderBottomColor: t.line },
  switcherRail: { gap: 6, paddingHorizontal: 12, paddingVertical: 8 },
  sheetChip: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: Tokens.radius.full,
    backgroundColor: Colors.fillSecondary, maxWidth: 220,
  },
  sheetChipActive: { backgroundColor: t.accentFill },
  sheetChipText: { fontSize: Type.caption1.fontSize, fontWeight: '700', color: t.text },
  // accentFill is derived to clear contrast against white (constants/colors).
  sheetChipTextActive: { color: Colors.textOnAccent },

  canvasWrap: { flex: 1, backgroundColor: t.surfaceAlt, overflow: 'hidden' },
  canvasContent: { alignItems: 'center', justifyContent: 'center' },
  canvasOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24,
  },
  canvasOverlaySolid: { backgroundColor: t.bg },
  saveBanner: {
    position: 'absolute', left: 12, right: 12, top: 12,
    padding: 14, gap: 8, borderRadius: Tokens.radius.lg,
    backgroundColor: t.bg, borderWidth: 1, borderColor: t.line,
  },
  saveBannerTitle: { fontSize: Type.subhead.fontSize, fontWeight: '700', color: t.text },
  saveBannerBody: { fontSize: Type.footnote.fontSize, color: t.textSecondary, lineHeight: 19 },

  marker: {
    position: 'absolute', width: PIN_MARKER_SIZE, height: PIN_MARKER_SIZE, borderRadius: PIN_MARKER_SIZE / 2,
    alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: Colors.textOnAccent,
  },
  markerExisting: { backgroundColor: t.textSecondary },
  markerPlaced: { backgroundColor: t.danger, borderWidth: 3 },

  panelWrap: { flex: 1 },
  panel: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 28, paddingVertical: 16 },
  panelTitle: { fontSize: Type.subhead.fontSize, fontWeight: '700', color: t.text, textAlign: 'center' },
  panelBody: { fontSize: Type.footnote.fontSize, color: t.textSecondary, textAlign: 'center', lineHeight: 19 },
  panelNote: { fontSize: Type.caption1.fontSize, color: t.textSecondary, textAlign: 'center' },
  panelWarn: { fontSize: Type.caption1.fontSize, color: t.warningLabel, textAlign: 'center', lineHeight: 17 },
  addButtons: { alignSelf: 'stretch', gap: 10, marginTop: 8 },

  footer: { paddingHorizontal: 14, paddingTop: 10, gap: 8, borderTopWidth: 1, borderTopColor: t.line, backgroundColor: t.bg },
  hint: { fontSize: Type.caption1.fontSize, color: t.textSecondary, textAlign: 'center' },
  footerRow: { flexDirection: 'row', gap: 10 },
});
