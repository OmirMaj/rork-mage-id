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

import React, { useCallback, useMemo, useState, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  Image, Modal, TextInput, Alert, Platform,
  GestureResponderEvent, ImageLoadEventData, NativeSyntheticEvent, LayoutChangeEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import Svg, { Polyline, Line, Circle, Text as SvgText } from 'react-native-svg';
import {
  ChevronLeft, MapPin, Pencil, Eraser, Camera, ClipboardList, X, Check,
  Trash2, Undo2, Image as ImageIcon, Ruler,
} from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import type { DrawingPin, DrawingPinKind } from '@/types';
import { stampPhotoLocation } from '@/utils/photoGeoStamp';

type Mode = 'pin' | 'draw' | 'measure' | 'calibrate';

// Minimum pixel distance between two calibration points — below this, the
// scale is meaningless (one-pixel jitter = wild errors in derived units).
const MIN_CALIBRATION_PX = 20;

const PIN_COLORS: Record<DrawingPinKind, string> = {
  note: Colors.primary,
  photo: '#3B82F6',
  punch: '#FF9500',
  rfi: '#8B5CF6',
};

export default function PlanViewerScreen() {
  const router = useRouter();
  const { canAccess } = useTierAccess();
  if (!canAccess('plan_viewer')) {
    return (
      <Paywall
        visible={true}
        feature="Plan Viewer"
        requiredTier="business"
        onClose={() => router.back()}
      />
    );
  }
  return <PlanViewerScreenInner />;
}

function PlanViewerScreenInner() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ sheetId?: string }>();
  const sheetId = typeof params.sheetId === 'string' ? params.sheetId : undefined;

  const {
    getPlanSheet, getPinsForPlan, addDrawingPin, updateDrawingPin, deleteDrawingPin,
    getMarkupsForPlan, addPlanMarkup, deletePlanMarkup,
    getPhotosForProject, getPunchItemsForProject, addProjectPhoto,
    upsertPlanCalibration, getCalibrationForPlan,
  } = useProjects();

  const sheet = sheetId ? getPlanSheet(sheetId) : null;

  const [mode, setMode] = useState<Mode>('pin');
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null);
  const [activeStroke, setActiveStroke] = useState<{ x: number; y: number }[]>([]);
  const [imgLayout, setImgLayout] = useState<{ w: number; h: number } | null>(null);
  const [imgNaturalRatio, setImgNaturalRatio] = useState<number | null>(null);
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
  const calibration = useMemo(() => sheet ? getCalibrationForPlan(sheet.id) : undefined, [sheet, getCalibrationForPlan]);

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
              Alert.alert('Points too close', 'Tap two points that are further apart — the longer the reference, the more accurate the scale.');
              return [];
            }
            setCalibrationInput({ distanceFt: '', visible: true });
          }
          return next;
        }
        return [pt]; // restart
      });
    }
  }, [mode, toNormalized, addDrawingPin, sheet, imgLayout]);

  // Drawing handlers
  const handleDrawStart = useCallback((e: GestureResponderEvent) => {
    if (mode !== 'draw') return;
    const pt = toNormalized(e.nativeEvent.locationX, e.nativeEvent.locationY);
    if (!pt) return;
    drawingRef.current = true;
    setActiveStroke([pt]);
  }, [mode, toNormalized]);

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
        color: Colors.error,
        strokeWidth: 3,
        points: activeStroke,
      });
    }
    setActiveStroke([]);
  }, [mode, activeStroke, addPlanMarkup, sheet]);

  const handleImageLoad = useCallback((e: NativeSyntheticEvent<ImageLoadEventData>) => {
    const s = e.nativeEvent.source;
    if (s?.width && s?.height) setImgNaturalRatio(s.width / s.height);
  }, []);

  const handleContainerLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (!imgNaturalRatio) {
      setImgLayout({ w: width, h: height });
      return;
    }
    // Compute the actually-rendered image box within the container for
    // resizeMode="contain". Everything (pin positions, strokes) uses these
    // effective dimensions so points track the image itself, not the
    // surrounding letterbox.
    const containerRatio = width / height;
    let w: number, h: number;
    if (containerRatio > imgNaturalRatio) {
      h = height;
      w = height * imgNaturalRatio;
    } else {
      w = width;
      h = width / imgNaturalRatio;
    }
    setImgLayout({ w, h });
  }, [imgNaturalRatio]);

  const undoLastMarkup = useCallback(() => {
    if (markups.length === 0) return;
    // Markups are stored newest-first; delete the newest one.
    deletePlanMarkup(markups[0].id);
  }, [markups, deletePlanMarkup]);

  const confirmCalibration = useCallback(() => {
    if (!sheet || pointBuffer.length !== 2 || !calibrationInput) return;
    const ft = Number(calibrationInput.distanceFt.replace(/[^0-9.]/g, ''));
    if (!Number.isFinite(ft) || ft <= 0) {
      Alert.alert('Enter a distance', 'Type the real-world distance between the two points, in feet.');
      return;
    }
    upsertPlanCalibration({
      planSheetId: sheet.id,
      projectId: sheet.projectId,
      p1: pointBuffer[0],
      p2: pointBuffer[1],
      realDistanceFt: ft,
    });
    setCalibrationInput(null);
    setPointBuffer([]);
    setMode('pin');
  }, [sheet, pointBuffer, calibrationInput, upsertPlanCalibration]);

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
          <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn} hitSlop={12}>
            <ChevronLeft size={22} color={Colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Sheet not found</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn} hitSlop={12}>
          <ChevronLeft size={22} color={Colors.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          {sheet.sheetNumber ? <Text style={styles.headerEyebrow}>{sheet.sheetNumber}</Text> : null}
          <Text style={styles.headerTitle} numberOfLines={1}>{sheet.name}</Text>
        </View>
        {calibration ? (
          <View style={[styles.modePill, { backgroundColor: Colors.successLight }]}>
            <Text style={[styles.modePillText, { color: Colors.success }]}>
              Scale: {calibration.realDistanceFt} ft ref
            </Text>
          </View>
        ) : null}
        <View style={styles.modePill}>
          <Text style={styles.modePillText}>{pins.length} {pins.length === 1 ? 'pin' : 'pins'}</Text>
        </View>
      </View>

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
            <Image
              source={{ uri: sheet.imageUri }}
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
                  stroke={Colors.error}
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
                  <Circle key={`pt-${i}`} cx={p.x * imgLayout.w} cy={p.y * imgLayout.h} r={5} fill={Colors.primary} stroke="#FFFFFF" strokeWidth={2} />
                ))}
                {pointBuffer.length === 2 ? (
                  <>
                    <Line
                      x1={pointBuffer[0].x * imgLayout.w}
                      y1={pointBuffer[0].y * imgLayout.h}
                      x2={pointBuffer[1].x * imgLayout.w}
                      y2={pointBuffer[1].y * imgLayout.h}
                      stroke={Colors.primary}
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
                          fill="#FFFFFF"
                          stroke="#FFFFFF"
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
                          fill={Colors.primary}
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
                  stroke={Colors.success}
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
                    borderColor: selectedPinId === pin.id ? Colors.accent : '#FFFFFF',
                    borderWidth: selectedPinId === pin.id ? 3 : 2,
                  },
                ]}
                onPress={() => setSelectedPinId(pin.id)}
                hitSlop={8}
              >
                <MapPin size={14} color="#FFFFFF" strokeWidth={2.5} />
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
      </View>

      {/* Mode hint line (measure / calibrate) */}
      {(mode === 'measure' || mode === 'calibrate') && (
        <View style={styles.hintBar}>
          <Ruler size={14} color={Colors.primary} />
          <Text style={styles.hintText}>
            {mode === 'measure'
              ? (scaleFtPerPx
                ? (pointBuffer.length === 0 ? 'Tap the start of your measurement.' :
                   pointBuffer.length === 1 ? 'Tap the end point.' :
                   measuredFt != null ? `${measuredFt.toFixed(1)} ft — tap again to re-measure.` : 'Measuring\u2026')
                : 'Calibrate the sheet first \u2014 tap Calibrate.')
              : (pointBuffer.length === 0 ? 'Tap one end of a known reference (e.g. a dimensioned wall).' :
                 pointBuffer.length === 1 ? 'Now tap the other end.' : 'Got it \u2014 enter the distance.')}
          </Text>
          <TouchableOpacity onPress={() => { setPointBuffer([]); setMode('pin'); }} hitSlop={8}>
            <X size={14} color={Colors.textSecondary} />
          </TouchableOpacity>
        </View>
      )}

      {/* Toolbar */}
      <View style={[styles.toolbar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        <TouchableOpacity
          style={[styles.toolBtn, mode === 'pin' && styles.toolBtnActive]}
          onPress={() => switchMode('pin')}
        >
          <MapPin size={18} color={mode === 'pin' ? Colors.textOnPrimary : Colors.text} />
          <Text style={[styles.toolBtnText, mode === 'pin' && styles.toolBtnTextActive]}>Pin</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.toolBtn, mode === 'draw' && styles.toolBtnActive]}
          onPress={() => switchMode('draw')}
        >
          <Pencil size={18} color={mode === 'draw' ? Colors.textOnPrimary : Colors.text} />
          <Text style={[styles.toolBtnText, mode === 'draw' && styles.toolBtnTextActive]}>Draw</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.toolBtn, mode === 'measure' && styles.toolBtnActive]}
          onPress={() => switchMode('measure')}
          disabled={!scaleFtPerPx}
        >
          <Ruler size={18} color={!scaleFtPerPx ? Colors.textMuted : mode === 'measure' ? Colors.textOnPrimary : Colors.text} />
          <Text style={[
            styles.toolBtnText,
            mode === 'measure' && styles.toolBtnTextActive,
            !scaleFtPerPx && styles.toolBtnTextDisabled,
          ]}>Measure</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.toolBtn, mode === 'calibrate' && styles.toolBtnActive]}
          onPress={() => switchMode('calibrate')}
        >
          <Check size={18} color={mode === 'calibrate' ? Colors.textOnPrimary : (calibration ? Colors.success : Colors.text)} />
          <Text style={[styles.toolBtnText, mode === 'calibrate' && styles.toolBtnTextActive]}>
            {calibration ? 'Re-cal' : 'Calibrate'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.toolBtn} onPress={undoLastMarkup} disabled={markups.length === 0}>
          <Undo2 size={18} color={markups.length === 0 ? Colors.textMuted : Colors.text} />
          <Text style={[styles.toolBtnText, markups.length === 0 && styles.toolBtnTextDisabled]}>Undo</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.toolBtn} onPress={() => {
          if (markups.length === 0) return;
          Alert.alert('Clear markup', 'Remove all strokes on this sheet?', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Clear', style: 'destructive', onPress: () => markups.forEach(m => deletePlanMarkup(m.id)) },
          ]);
        }} disabled={markups.length === 0}>
          <Eraser size={18} color={markups.length === 0 ? Colors.textMuted : Colors.text} />
          <Text style={[styles.toolBtnText, markups.length === 0 && styles.toolBtnTextDisabled]}>Clear</Text>
        </TouchableOpacity>
      </View>

      {/* Pin detail modal */}
      <PinDetailModal
        pin={selectedPin}
        projectId={sheet.projectId}
        photos={projectPhotos}
        punchItems={projectPunch}
        onClose={() => setSelectedPinId(null)}
        onUpdate={(updates) => {
          if (selectedPin) updateDrawingPin(selectedPin.id, updates);
        }}
        onDelete={() => {
          if (selectedPin) {
            deleteDrawingPin(selectedPin.id);
            setSelectedPinId(null);
          }
        }}
        onAddPhoto={async () => {
          if (!selectedPin) return;
          const perm = await ImagePicker.requestCameraPermissionsAsync();
          if (perm.status !== 'granted') { Alert.alert('Permission needed', 'Camera access is required.'); return; }
          const result = await ImagePicker.launchCameraAsync({ quality: 0.7, allowsEditing: false });
          if (result.canceled || !result.assets?.[0]) return;
          const uri = result.assets[0].uri;
          const id = `photo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
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
                <Ruler size={16} color={Colors.primary} />
                <Text style={styles.modalTitle}>Set scale</Text>
              </View>
              <TouchableOpacity onPress={() => { setCalibrationInput(null); setPointBuffer([]); }} style={styles.iconBtn}>
                <X size={18} color={Colors.text} />
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
              <Check size={16} color={Colors.textOnPrimary} />
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
  pin, projectId, photos, punchItems,
  onClose, onUpdate, onDelete, onAddPhoto,
}: {
  pin: DrawingPin | null;
  projectId: string;
  photos: { id: string; uri: string; tag?: string }[];
  punchItems: { id: string; description: string; location?: string; status: string }[];
  onClose: () => void;
  onUpdate: (updates: Partial<DrawingPin>) => void;
  onDelete: () => void;
  onAddPhoto: () => void;
}) {
  const [draftLabel, setDraftLabel] = useState<string>('');
  const [view, setView] = useState<'main' | 'photo' | 'punch'>('main');

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
                <MapPin size={12} color="#FFFFFF" />
              </View>
              <Text style={styles.modalTitle}>
                {view === 'main' ? 'Pin' : view === 'photo' ? 'Link a photo' : 'Link a punch item'}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.iconBtn}>
              <X size={18} color={Colors.text} />
            </TouchableOpacity>
          </View>

          {view === 'main' && (
            <>
              <Text style={styles.label}>Label</Text>
              <TextInput
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
                  <Camera size={16} color={Colors.primary} />
                  <Text style={styles.linkCellTitle}>Take photo</Text>
                  <Text style={styles.linkCellSub}>Shoot & pin it here</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.linkCell} onPress={() => setView('photo')}>
                  <ImageIcon size={16} color={Colors.primary} />
                  <Text style={styles.linkCellTitle}>Existing photo</Text>
                  <Text style={styles.linkCellSub}>Link one already on file</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.linkCell} onPress={() => setView('punch')}>
                  <ClipboardList size={16} color={Colors.primary} />
                  <Text style={styles.linkCellTitle}>Punch item</Text>
                  <Text style={styles.linkCellSub}>Link to open punch</Text>
                </TouchableOpacity>
              </View>

              {linkedPhoto && (
                <View style={styles.linkedRow}>
                  <Image source={{ uri: linkedPhoto.uri }} style={styles.linkedThumb} />
                  <Text style={styles.linkedText}>Photo linked</Text>
                  <TouchableOpacity onPress={() => onUpdate({ linkedPhotoId: undefined, kind: 'note' })} style={styles.iconBtn}>
                    <X size={14} color={Colors.textSecondary} />
                  </TouchableOpacity>
                </View>
              )}
              {linkedPunch && (
                <View style={styles.linkedRow}>
                  <ClipboardList size={14} color={Colors.accent} />
                  <Text style={styles.linkedText} numberOfLines={2}>{linkedPunch.description}</Text>
                  <TouchableOpacity onPress={() => onUpdate({ linkedPunchItemId: undefined, kind: 'note' })} style={styles.iconBtn}>
                    <X size={14} color={Colors.textSecondary} />
                  </TouchableOpacity>
                </View>
              )}

              <TouchableOpacity style={styles.deleteBtn} onPress={() => {
                Alert.alert('Delete pin', 'Remove this pin?', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Delete', style: 'destructive', onPress: onDelete },
                ]);
              }}>
                <Trash2 size={15} color={Colors.error} />
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
  return (
    <View>
      <TouchableOpacity onPress={onBack} style={styles.backLink}>
        <ChevronLeft size={14} color={Colors.primary} />
        <Text style={styles.backLinkText}>Back</Text>
      </TouchableOpacity>
      {photos.length === 0 ? (
        <Text style={styles.emptyHint}>No photos on this project yet.</Text>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 8 }}>
          {photos.map(p => (
            <TouchableOpacity key={p.id} onPress={() => onPick(p.id)} style={styles.photoTile}>
              <Image source={{ uri: p.uri }} style={styles.photoTileImg} />
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
  const open = items.filter(i => i.status !== 'closed');
  return (
    <View>
      <TouchableOpacity onPress={onBack} style={styles.backLink}>
        <ChevronLeft size={14} color={Colors.primary} />
        <Text style={styles.backLinkText}>Back</Text>
      </TouchableOpacity>
      {open.length === 0 ? (
        <Text style={styles.emptyHint}>No open punch items on this project.</Text>
      ) : (
        <ScrollView style={{ maxHeight: 260 }}>
          {open.map(pi => (
            <TouchableOpacity key={pi.id} onPress={() => onPick(pi.id)} style={styles.punchRow}>
              <ClipboardList size={14} color={Colors.accent} />
              <View style={{ flex: 1 }}>
                <Text style={styles.punchRowTitle} numberOfLines={2}>{pi.description}</Text>
                {pi.location ? <Text style={styles.punchRowSub}>{pi.location}</Text> : null}
              </View>
              <Check size={14} color={Colors.primary} />
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#1C1C1E' },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 14, paddingVertical: 10,
    backgroundColor: Colors.surface, borderBottomColor: Colors.borderLight, borderBottomWidth: 1,
  },
  headerBtn: { padding: 6, borderRadius: 8 },
  headerEyebrow: { color: Colors.textSecondary, fontSize: 11, fontWeight: '600', letterSpacing: 0.6, textTransform: 'uppercase' },
  headerTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' },
  modePill: { backgroundColor: Colors.surfaceAlt, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10 },
  modePillText: { color: Colors.text, fontSize: 12, fontWeight: '600' },

  canvasWrap: { flex: 1, backgroundColor: '#1C1C1E', overflow: 'hidden' },
  canvasScroll: { flexGrow: 1, justifyContent: 'center', alignItems: 'center' },
  imageBox: { position: 'relative' },
  image: { width: '100%', height: '100%' },

  pin: {
    position: 'absolute',
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.35, shadowRadius: 3,
    elevation: 4,
  },

  toolbar: {
    flexDirection: 'row', backgroundColor: Colors.surface,
    paddingHorizontal: 12, paddingTop: 10,
    borderTopColor: Colors.borderLight, borderTopWidth: 1,
    gap: 6, justifyContent: 'space-around',
  },
  toolBtn: {
    flex: 1, alignItems: 'center', gap: 2,
    paddingVertical: 8, paddingHorizontal: 6, borderRadius: 10,
  },
  toolBtnActive: { backgroundColor: Colors.primary },
  toolBtnText: { color: Colors.text, fontSize: 11, fontWeight: '600', marginTop: 2 },
  toolBtnTextActive: { color: Colors.textOnPrimary },
  toolBtnTextDisabled: { color: Colors.textMuted },

  hintBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 14, paddingVertical: 8,
    backgroundColor: '#F0F9F2',
    borderTopColor: Colors.borderLight, borderTopWidth: 1,
    borderBottomColor: Colors.borderLight, borderBottomWidth: 1,
  },
  hintText: { flex: 1, color: Colors.text, fontSize: 12, fontWeight: '500' },

  distanceRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  unitLabel: { color: Colors.textSecondary, fontSize: 13, fontWeight: '600' },
  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: Colors.primary, paddingHorizontal: 14, paddingVertical: 11, borderRadius: 10,
  },
  primaryBtnText: { color: Colors.textOnPrimary, fontSize: 14, fontWeight: '700' },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: Colors.surface, padding: 16, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    gap: 10, maxHeight: '80%',
    ...Platform.select({ web: { maxWidth: 520, alignSelf: 'center', width: '100%', borderRadius: 16, marginBottom: 20 } as object, default: {} as object }),
  },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  modalTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' },
  modalPinBadge: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  iconBtn: { padding: 6, borderRadius: 8 },
  label: { color: Colors.textSecondary, fontSize: 12, fontWeight: '600' },
  input: {
    backgroundColor: Colors.surfaceAlt, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    color: Colors.text, fontSize: 14, borderColor: Colors.borderLight, borderWidth: 1, minHeight: 44,
  },

  linkRow: { flexDirection: 'row', gap: 8, marginTop: 6 },
  linkCell: {
    flex: 1, backgroundColor: Colors.surfaceAlt, padding: 10, borderRadius: 10,
    borderColor: Colors.borderLight, borderWidth: 1, gap: 3,
  },
  linkCellTitle: { color: Colors.text, fontSize: 12, fontWeight: '700', marginTop: 4 },
  linkCellSub: { color: Colors.textSecondary, fontSize: 10 },

  linkedRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: Colors.successLight, padding: 10, borderRadius: 10, marginTop: 6,
  },
  linkedThumb: { width: 36, height: 36, borderRadius: 6 },
  linkedText: { flex: 1, color: Colors.text, fontSize: 12, fontWeight: '600' },

  deleteBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    justifyContent: 'center',
    paddingVertical: 10, borderRadius: 10, marginTop: 8,
    borderColor: Colors.errorLight, borderWidth: 1,
  },
  deleteBtnText: { color: Colors.error, fontSize: 13, fontWeight: '700' },

  backLink: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingVertical: 4 },
  backLinkText: { color: Colors.primary, fontSize: 13, fontWeight: '600' },
  emptyHint: { color: Colors.textSecondary, fontSize: 13, padding: 20, textAlign: 'center' },

  photoTile: { width: 80, height: 80, borderRadius: 8, overflow: 'hidden', backgroundColor: Colors.surfaceAlt },
  photoTileImg: { width: '100%', height: '100%' },

  punchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: Colors.surfaceAlt, padding: 10, borderRadius: 10, marginBottom: 6,
  },
  punchRowTitle: { color: Colors.text, fontSize: 13, fontWeight: '600' },
  punchRowSub: { color: Colors.textSecondary, fontSize: 11, marginTop: 2 },
});
