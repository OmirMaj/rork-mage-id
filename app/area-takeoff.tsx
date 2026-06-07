// area-takeoff.tsx — circle an area on a plan/photo → instant quantity → YOUR price.
//
// Distinct from app/takeoff.tsx (AI PDF→quantities). This is the touch-first
// "trace a region, size it, price it from your own cost database" feature — the
// combination no competitor ships. Trace a region on a plan, get the real square
// footage (same calibration model as plan-viewer), and price it from your personal
// cost database (Build A2) — not generic regional data. Desktop takeoff tools
// (PlanSwift/STACK/Bluebeam) are $1,700–5,000/yr/seat, desktop/web-bound, and
// dead-end at an estimate; this is on the phone, in your own learned rates.
//
// B1 scope: AREA takeoff (polygon) + tap-two-points scale + cost-DB pricing.
// Linear/count takeoff, freehand lasso, AI auto-detect, reusing saved plan sheets,
// and "add to estimate" are the documented Phase 2.
//
// Built on the app's proven stack: normalized 0–1 coords, react-native-svg
// overlay, GestureResponder taps, expo-image-picker. No new native deps.

import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, Modal,
  TextInput, Platform, type GestureResponderEvent, type LayoutChangeEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import Svg, { Polygon as SvgPolygon, Circle, Line } from 'react-native-svg';
import {
  ChevronLeft, ImagePlus, Ruler, PenTool, Undo2, Trash2, Check, Library,
} from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { Colors, type ThemeColors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import { buildCostDatabase } from '@/utils/costDatabase';
import { priceTakeoff, tradesForUnit } from '@/utils/takeoffEstimate';
import {
  feetPerPixel, polygonAreaSqFt, centroid, formatSqFt,
  type NormPoint,
} from '@/utils/takeoffGeometry';
import { formatMoneyFull } from '@/utils/jobCostEngine';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

type Mode = 'calibrate' | 'area';

export default function AreaTakeoffScreen() {
  const router = useRouter();
  const { canAccess } = useTierAccess();
  if (!canAccess('job_costing')) {
    return (
      <Paywall visible={true} feature="Visual Takeoff" requiredTier="pro" onClose={() => router.back()} />
    );
  }
  return <AreaTakeoffInner />;
}

function AreaTakeoffInner() {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { projects, commitments } = useProjects();

  const [imageUri, setImageUri] = useState<string | null>(null);
  const [imgLayout, setImgLayout] = useState<{ w: number; h: number } | null>(null);
  const [mode, setMode] = useState<Mode>('calibrate');

  const [calPoints, setCalPoints] = useState<NormPoint[]>([]);
  const [calibration, setCalibration] = useState<{ p1: NormPoint; p2: NormPoint; realDistanceFt: number } | null>(null);
  const [distanceModal, setDistanceModal] = useState(false);
  const [distanceInput, setDistanceInput] = useState('');

  const [areaPoints, setAreaPoints] = useState<NormPoint[]>([]);
  const [selectedTrade, setSelectedTrade] = useState<string | null>(null);

  const db = useMemo(() => buildCostDatabase(projects, commitments), [projects, commitments]);
  const sfTrades = useMemo(() => tradesForUnit(db, 'SF'), [db]);

  const ftPerPx = useMemo(
    () => (calibration && imgLayout ? feetPerPixel(calibration, imgLayout.w, imgLayout.h) : null),
    [calibration, imgLayout],
  );
  const areaSqFt = useMemo(
    () => (ftPerPx && imgLayout && areaPoints.length >= 3 ? polygonAreaSqFt(areaPoints, imgLayout.w, imgLayout.h, ftPerPx) : 0),
    [ftPerPx, imgLayout, areaPoints],
  );
  const pricing = useMemo(
    () => (selectedTrade && areaSqFt > 0 ? priceTakeoff(db, selectedTrade, 'SF', areaSqFt) : null),
    [db, selectedTrade, areaSqFt],
  );

  const pickImage = useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 1.0,
      allowsEditing: false,
      exif: false,
    });
    if (result.canceled || !result.assets?.[0]) return;
    setImageUri(result.assets[0].uri);
    setCalibration(null);
    setCalPoints([]);
    setAreaPoints([]);
    setMode('calibrate');
  }, []);

  const onImageLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setImgLayout({ w: width, h: height });
  }, []);

  const toNorm = useCallback((ex: number, ey: number): NormPoint | null => {
    if (!imgLayout) return null;
    return {
      x: Math.max(0, Math.min(1, ex / imgLayout.w)),
      y: Math.max(0, Math.min(1, ey / imgLayout.h)),
    };
  }, [imgLayout]);

  const handleTap = useCallback((e: GestureResponderEvent) => {
    const pt = toNorm(e.nativeEvent.locationX, e.nativeEvent.locationY);
    if (!pt) return;
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (mode === 'calibrate') {
      setCalPoints(prev => {
        const next = [...prev, pt].slice(-2);
        if (next.length === 2) setDistanceModal(true);
        return next;
      });
    } else {
      setAreaPoints(prev => [...prev, pt]);
    }
  }, [mode, toNorm]);

  const confirmDistance = useCallback(() => {
    const ft = parseFloat(distanceInput);
    if (calPoints.length === 2 && Number.isFinite(ft) && ft > 0) {
      setCalibration({ p1: calPoints[0], p2: calPoints[1], realDistanceFt: ft });
      setMode('area');
    }
    setDistanceModal(false);
    setDistanceInput('');
  }, [distanceInput, calPoints]);

  const undoPoint = useCallback(() => {
    if (mode === 'calibrate') setCalPoints(prev => prev.slice(0, -1));
    else setAreaPoints(prev => prev.slice(0, -1));
  }, [mode]);

  const clearPoints = useCallback(() => {
    if (mode === 'calibrate') { setCalPoints([]); setCalibration(null); }
    else setAreaPoints([]);
  }, [mode]);

  const px = (p: NormPoint) => ({ cx: p.x * (imgLayout?.w ?? 0), cy: p.y * (imgLayout?.h ?? 0) });
  const polygonStr = areaPoints.map(p => `${p.x * (imgLayout?.w ?? 0)},${p.y * (imgLayout?.h ?? 0)}`).join(' ');
  const labelPt = areaPoints.length >= 3 ? centroid(areaPoints) : null;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
          <ChevronLeft size={22} color={t.text} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.headerEyebrow}>Visual Takeoff · MAGE</Text>
          <Text style={styles.headerTitle} numberOfLines={1}>Circle an area</Text>
        </View>
        {imageUri ? (
          <TouchableOpacity onPress={pickImage} style={styles.headerBtn} hitSlop={12} accessibilityLabel="New image">
            <ImagePlus size={20} color={t.accent} />
          </TouchableOpacity>
        ) : <View style={styles.headerBtn} />}
      </View>

      {!imageUri ? (
        <View style={styles.empty}>
          <View style={[styles.emptyIcon, { backgroundColor: t.accent + '18' }]}>
            <PenTool size={34} color={t.accent} strokeWidth={1.6} />
          </View>
          <Text style={styles.emptyTitle}>Trace it, price it</Text>
          <Text style={styles.emptyMsg}>
            Pick a floor plan or a photo of one, set the scale with two taps, then trace an area.
            We&apos;ll size it and price it from your own cost database.
          </Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={pickImage} activeOpacity={0.85} testID="takeoff-pick">
            <ImagePlus size={18} color="#fff" />
            <Text style={styles.primaryBtnText}>Pick a plan or photo</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: 40 + insets.bottom }} showsVerticalScrollIndicator={false}>
          {/* Mode toggle */}
          <View style={styles.modeRow}>
            <ModeBtn active={mode === 'calibrate'} icon={<Ruler size={15} color={mode === 'calibrate' ? Colors.textOnAccent : t.text} />} label={calibration ? 'Scale set' : 'Set scale'} onPress={() => setMode('calibrate')} t={t} styles={styles} />
            <ModeBtn active={mode === 'area'} icon={<PenTool size={15} color={mode === 'area' ? Colors.textOnAccent : t.text} />} label="Trace area" onPress={() => setMode('area')} disabled={!calibration} t={t} styles={styles} />
          </View>

          <Text style={styles.instruction}>
            {mode === 'calibrate'
              ? calibration ? 'Scale is set. Switch to Trace area.' : 'Tap two points a known distance apart (a door = 3 ft, a grid line, a dimension string).'
              : 'Tap around the area to trace it. Add at least 3 points.'}
          </Text>

          {/* Canvas */}
          <View style={styles.canvasWrap}>
            <View
              style={styles.canvas}
              onLayout={onImageLayout}
              onStartShouldSetResponder={() => true}
              onResponderRelease={handleTap}
              testID="takeoff-canvas"
            >
              <Image source={{ uri: imageUri }} style={styles.image} resizeMode="contain" />
              {imgLayout && (
                <Svg style={StyleSheet.absoluteFill} width={imgLayout.w} height={imgLayout.h}>
                  {/* calibration line */}
                  {calPoints.length === 2 && (
                    <Line x1={px(calPoints[0]).cx} y1={px(calPoints[0]).cy} x2={px(calPoints[1]).cx} y2={px(calPoints[1]).cy} stroke={t.accentHot} strokeWidth={2} strokeDasharray="6,4" />
                  )}
                  {(mode === 'calibrate' ? calPoints : []).map((p, i) => (
                    <Circle key={`c${i}`} {...px(p)} r={6} fill={t.accentHot} stroke="#fff" strokeWidth={1.5} />
                  ))}
                  {/* area polygon */}
                  {areaPoints.length >= 2 && (
                    <SvgPolygon points={polygonStr} fill={t.accent + '33'} stroke={t.accent} strokeWidth={2} />
                  )}
                  {(mode === 'area' ? areaPoints : []).map((p, i) => (
                    <Circle key={`a${i}`} {...px(p)} r={5} fill={t.accent} stroke="#fff" strokeWidth={1.5} />
                  ))}
                </Svg>
              )}
              {labelPt && areaSqFt > 0 && (
                <View style={[styles.areaLabel, { left: `${labelPt.x * 100}%`, top: `${labelPt.y * 100}%` }]} pointerEvents="none">
                  <Text style={styles.areaLabelText}>{formatSqFt(areaSqFt)}</Text>
                </View>
              )}
            </View>

            {/* canvas controls */}
            <View style={styles.canvasTools}>
              <TouchableOpacity style={styles.toolBtn} onPress={undoPoint} hitSlop={8} testID="takeoff-undo"><Undo2 size={16} color={t.text} /><Text style={styles.toolText}>Undo</Text></TouchableOpacity>
              <TouchableOpacity style={styles.toolBtn} onPress={clearPoints} hitSlop={8} testID="takeoff-clear"><Trash2 size={16} color={t.danger} /><Text style={[styles.toolText, { color: t.danger }]}>Clear</Text></TouchableOpacity>
            </View>
          </View>

          {/* Result */}
          <View style={styles.result}>
            {!calibration ? (
              <Text style={styles.resultHint}>Set the scale to size your area.</Text>
            ) : areaSqFt <= 0 ? (
              <Text style={styles.resultHint}>Trace an area (3+ points) to size it.</Text>
            ) : (
              <>
                <View style={styles.resultHead}>
                  <Text style={styles.resultArea}>{formatSqFt(areaSqFt)}</Text>
                  {pricing?.matched && pricing.amount !== null && (
                    <Text style={styles.resultPrice}>{formatMoneyFull(pricing.amount)}</Text>
                  )}
                </View>

                {sfTrades.length === 0 ? (
                  <Text style={styles.resultHint}>
                    Pick a trade to price it — but your cost database has no SF-based trades yet. Close jobs with linked commitments and rates appear here.
                  </Text>
                ) : (
                  <>
                    <Text style={styles.pickLabel}>Price as</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 2 }}>
                      {sfTrades.map(e => {
                        const sel = selectedTrade === e.trade;
                        return (
                          <TouchableOpacity
                            key={e.key}
                            style={[styles.chip, sel && { backgroundColor: t.accent, borderColor: t.accent }]}
                            onPress={() => setSelectedTrade(sel ? null : e.trade)}
                            activeOpacity={0.8}
                            testID={`takeoff-trade-${e.key}`}
                          >
                            <Text style={[styles.chipText, sel && { color: Colors.textOnAccent }]}>{e.trade}</Text>
                            <Text style={[styles.chipRate, sel && { color: Colors.textOnAccent }]}>${e.suggestedRate.toFixed(2)}/SF</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </ScrollView>

                    {pricing?.matched && pricing.rate !== null && (
                      <View style={styles.priceDetail}>
                        <Text style={styles.priceLine}>
                          {formatSqFt(areaSqFt)} × ${pricing.rate.toFixed(2)}/SF
                        </Text>
                        {pricing.low !== null && pricing.high !== null && (
                          <Text style={styles.priceRange}>
                            Range {formatMoneyFull(pricing.low)}–{formatMoneyFull(pricing.high)} · {pricing.confidence} confidence ({pricing.entry?.jobCount} job{pricing.entry?.jobCount === 1 ? '' : 's'})
                          </Text>
                        )}
                      </View>
                    )}
                  </>
                )}
              </>
            )}
          </View>

          <TouchableOpacity style={styles.crossLink} onPress={() => router.push('/cost-database' as any)} activeOpacity={0.7} testID="takeoff-costdb-link">
            <Library size={16} color={t.accent} />
            <Text style={styles.crossLinkText}>Rates come from your Cost Database</Text>
          </TouchableOpacity>

          <Text style={styles.note}>
            Square footage uses the same calibration as the plan viewer (two points + a known
            distance). Pricing is your blended learned rate per trade. Linear/count takeoff,
            freehand lasso, and &ldquo;add to estimate&rdquo; are coming next.
          </Text>
        </ScrollView>
      )}

      {/* distance entry */}
      <Modal visible={distanceModal} transparent animationType="fade" onRequestClose={() => setDistanceModal(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Known distance</Text>
            <Text style={styles.modalSub}>How far apart are those two points, in feet?</Text>
            <TextInput
              style={styles.modalInput}
              value={distanceInput}
              onChangeText={setDistanceInput}
              keyboardType="decimal-pad"
              placeholder="e.g. 3"
              placeholderTextColor={t.textMuted}
              autoFocus
              testID="takeoff-distance-input"
            />
            <View style={styles.modalBtns}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => { setDistanceModal(false); setCalPoints([]); }}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalConfirm} onPress={confirmDistance} testID="takeoff-distance-confirm">
                <Check size={16} color="#fff" />
                <Text style={styles.modalConfirmText}>Set scale</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function ModeBtn({ active, icon, label, onPress, disabled, t, styles }: {
  active: boolean; icon: React.ReactNode; label: string; onPress: () => void; disabled?: boolean;
  t: ThemeColors; styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <TouchableOpacity
      style={[styles.modeBtn, active && { backgroundColor: t.accent, borderColor: t.accent }, disabled && { opacity: 0.4 }]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.8}
    >
      {icon}
      <Text style={[styles.modeBtnText, active && { color: Colors.textOnAccent }]}>{label}</Text>
    </TouchableOpacity>
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

  empty: { flex: 1, alignItems: 'center' as const, justifyContent: 'center' as const, padding: 40, gap: 14 },
  emptyIcon: { width: 76, height: 76, borderRadius: Tokens.radius.panel, alignItems: 'center' as const, justifyContent: 'center' as const },
  emptyTitle: { fontSize: Type.title3.fontSize, fontWeight: '800' as const, color: t.text },
  emptyMsg: { fontSize: Type.subhead.fontSize, color: t.textSecondary, textAlign: 'center' as const, lineHeight: 21, maxWidth: 320 },
  primaryBtn: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8,
    backgroundColor: t.accent, paddingHorizontal: 22, paddingVertical: 13, borderRadius: Tokens.radius.lg, marginTop: 6,
  },
  primaryBtnText: { color: Colors.textOnAccent, fontSize: Type.callout.fontSize, fontWeight: '700' as const },

  modeRow: { flexDirection: 'row' as const, gap: 10, padding: 16, paddingBottom: 8 },
  modeBtn: {
    flex: 1, flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 6,
    backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, borderRadius: Tokens.radius.card, paddingVertical: 11,
  },
  modeBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: t.text },

  instruction: { fontSize: Type.caption1.fontSize, color: t.textSecondary, paddingHorizontal: 16, marginBottom: 10, lineHeight: 17 },

  canvasWrap: { paddingHorizontal: 16 },
  canvas: {
    width: '100%' as const, aspectRatio: 0.75, backgroundColor: t.surfaceAlt,
    borderRadius: Tokens.radius.card, borderWidth: 1, borderColor: t.line, overflow: 'hidden' as const,
  },
  image: { width: '100%' as const, height: '100%' as const },
  areaLabel: {
    position: 'absolute' as const, transform: [{ translateX: -28 }, { translateY: -12 }],
    backgroundColor: t.text, paddingHorizontal: 8, paddingVertical: 3, borderRadius: Tokens.radius.sm,
  },
  areaLabelText: { color: t.bg, fontSize: Type.caption1.fontSize, fontWeight: '800' as const },
  canvasTools: { flexDirection: 'row' as const, justifyContent: 'flex-end' as const, gap: 14, paddingVertical: 8 },
  toolBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 5 },
  toolText: { fontSize: Type.caption1.fontSize, fontWeight: '700' as const, color: t.text },

  result: {
    margin: 16, marginTop: 4, backgroundColor: t.surface, borderRadius: Tokens.radius.panel,
    borderWidth: 1, borderColor: t.line, padding: 16, gap: 10,
  },
  resultHint: { fontSize: Type.subhead.fontSize, color: t.textMuted, lineHeight: 20 },
  resultHead: { flexDirection: 'row' as const, alignItems: 'baseline' as const, justifyContent: 'space-between' as const },
  resultArea: { fontSize: Type.title2.fontSize, fontWeight: '800' as const, color: t.text },
  resultPrice: { fontSize: Type.title3.fontSize, fontWeight: '800' as const, color: t.accent },
  pickLabel: { fontSize: Type.caption2.fontSize, color: t.textMuted, fontWeight: '700' as const, letterSpacing: 0.3 },
  chip: {
    backgroundColor: t.surfaceAlt, borderWidth: 1, borderColor: t.line, borderRadius: Tokens.radius.sm,
    paddingHorizontal: 12, paddingVertical: 8, alignItems: 'center' as const, gap: 1,
  },
  chipText: { fontSize: Type.caption1.fontSize, fontWeight: '700' as const, color: t.text },
  chipRate: { fontSize: Type.caption2.fontSize, color: t.textSecondary },
  priceDetail: { borderTopWidth: 1, borderTopColor: t.line, paddingTop: 10, gap: 3 },
  priceLine: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: t.text },
  priceRange: { fontSize: Type.caption1.fontSize, color: t.textSecondary },

  crossLink: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8,
    backgroundColor: t.accent + '12', borderRadius: Tokens.radius.card, borderWidth: 1, borderColor: t.accent + '33',
    padding: 12, marginHorizontal: 16,
  },
  crossLinkText: { flex: 1, fontSize: Type.footnote.fontSize, color: t.textSecondary, fontWeight: '600' as const },
  note: { fontSize: Type.caption1.fontSize, color: t.textMuted, lineHeight: 17, marginHorizontal: 16, marginTop: 12 },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center' as const, justifyContent: 'center' as const, padding: 30 },
  modalCard: { width: '100%' as const, maxWidth: 360, backgroundColor: t.surface, borderRadius: Tokens.radius.panel, padding: 20, gap: 10 },
  modalTitle: { fontSize: Type.headline.fontSize, fontWeight: '800' as const, color: t.text },
  modalSub: { fontSize: Type.footnote.fontSize, color: t.textSecondary, lineHeight: 18 },
  modalInput: {
    borderWidth: 1, borderColor: t.line, borderRadius: Tokens.radius.sm, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: Type.title3.fontSize, fontWeight: '700' as const, color: t.text, backgroundColor: t.surfaceAlt, marginTop: 4,
  },
  modalBtns: { flexDirection: 'row' as const, gap: 10, marginTop: 6 },
  modalCancel: { flex: 1, alignItems: 'center' as const, justifyContent: 'center' as const, paddingVertical: 12, borderRadius: Tokens.radius.sm, borderWidth: 1, borderColor: t.line },
  modalCancelText: { fontSize: Type.callout.fontSize, fontWeight: '700' as const, color: t.text },
  modalConfirm: { flex: 1, flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 6, paddingVertical: 12, borderRadius: Tokens.radius.sm, backgroundColor: t.accent },
  modalConfirmText: { fontSize: Type.callout.fontSize, fontWeight: '700' as const, color: Colors.textOnAccent },
});
