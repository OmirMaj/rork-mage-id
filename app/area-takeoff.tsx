// area-takeoff.tsx — trace a region on a plan/photo → quantity → YOUR price →
// straight into the estimate. The feature no competitor ships, end to end.
//
// Distinct from app/takeoff.tsx (AI PDF→quantities). This is the touch-first
// "trace it, size it, price it from your own cost database, drop it in the
// estimate" flow. Desktop takeoff tools (PlanSwift/STACK/Bluebeam) are
// $1,700–5,000/yr/seat, desktop/web-bound, and dead-end at an estimate; this is
// on the phone, in your own learned rates, and it closes the loop back into A.
//
// Phase 2 (this file): area + linear + count takeoff; reuse a project's saved
// plan sheets + their stored calibration; and "Add to estimate" which appends a
// priced line to project.linkedEstimate (the actuals from that job then sharpen
// the very rates this screen prices with — A→B→A).
//
// Built on the app's proven stack: normalized 0–1 coords, react-native-svg
// overlay, GestureResponder taps, expo-image-picker. No new native deps.

import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, Modal,
  TextInput, Platform, type GestureResponderEvent, type LayoutChangeEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import Svg, { Polygon as SvgPolygon, Polyline as SvgPolyline, Circle, Line } from 'react-native-svg';
import {
  ChevronLeft, ImagePlus, Ruler, PenTool, Undo2, Trash2, Check, Library,
  Square, Minus, Hash, Plus, FileImage, CheckCircle2, Spline, Calculator,
} from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { Colors, type ThemeColors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { useMaterialReceipts } from '@/hooks/useMaterialReceipts';
import { useCostSeeds } from '@/hooks/useCostSeeds';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import { buildCostDatabase } from '@/utils/costDatabase';
import { priceTakeoff, tradesForUnit, type TakeoffUnit } from '@/utils/takeoffEstimate';
import {
  getLivePrices, getRegionMultiplier, getMaterialCostBreakdown,
  CATEGORY_COST_FACTORS, CATEGORY_META, type MaterialItem,
} from '@/constants/materials';
import {
  feetPerPixel, polygonAreaSqFt, polylineLengthFt, centroid, formatSqFt, formatLinearFt,
  type NormPoint,
} from '@/utils/takeoffGeometry';
import { commitEstimatePatch } from '@/utils/estimateCommit';
import { generateUUID } from '@/utils/generateId';
import type { LinkedEstimate, LinkedEstimateItem } from '@/types';
import { formatMoneyFull } from '@/utils/jobCostEngine';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

type Mode = 'calibrate' | 'draw';
type Kind = 'area' | 'linear' | 'count';

const KIND_UNIT: Record<Kind, TakeoffUnit> = { area: 'SF', linear: 'LF', count: 'EA' };

// ─── Materials-engine rate fallback ──────────────────────────────────────
// When the GC has no closed-job history for a trade, the visual takeoff used
// to dead-end: a real measured quantity that literally couldn't be priced.
// This surfaces a deterministic installed rate from constants/materials.ts
// (regional-adjusted, material + labor + equipment + category waste) so a
// measured area/length/count can ALWAYS be priced — engine rate or a manual
// rate the user types.

const ENGINE_PRICE_SEED = 100; // fixed → engine rates are reproducible

// Only exact-unit SKUs are used so we never guess a square→sqft conversion.
const ENGINE_UNIT_ALIASES: Record<TakeoffUnit, string[]> = {
  SF: ['sq ft'],
  LF: ['lin ft'],
  EA: ['each'],
};

interface EngineOption {
  category: string;
  label: string;
  rate: number; // clean installed $/unit (NO waste — waste lives in billableQuantity)
}

function buildEngineRate(priced: MaterialItem[], category: string, unit: TakeoffUnit): number | null {
  const aliases = ENGINE_UNIT_ALIASES[unit];
  const skus = priced.filter(m =>
    m.specTier === 'base' &&
    m.category === category &&
    aliases.includes(m.unit.toLowerCase().trim()),
  );
  if (skus.length === 0) return null;
  // Clean installed unit cost only. Waste is applied EXACTLY ONCE downstream in
  // billableQuantity (the user-adjustable waste factor) — do NOT fold the SKU's
  // internal wasteFactor in here, or engine-priced lines double-count waste.
  const installed = skus.map(m => {
    const b = getMaterialCostBreakdown(m);
    return b.materialCost + b.laborCost + b.equipmentCost;
  }).sort((a, z) => a - z);
  const mid = installed[Math.floor(installed.length / 2)]; // median SKU
  return Number(mid.toFixed(2));
}

/** Every materials category that has an installed engine rate for this unit. */
function engineRatesForUnit(location: string, unit: TakeoffUnit): EngineOption[] {
  const priced = getLivePrices(ENGINE_PRICE_SEED, getRegionMultiplier(location));
  const out: EngineOption[] = [];
  for (const category of Object.keys(CATEGORY_COST_FACTORS)) {
    const rate = buildEngineRate(priced, category, unit);
    if (rate != null && rate > 0) {
      out.push({ category, label: CATEGORY_META[category]?.label ?? category, rate });
    }
  }
  return out.sort((a, b) => a.rate - b.rate);
}

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
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const router = useRouter();
  const { projectId } = useLocalSearchParams<{ projectId?: string }>();
  const {
    projects, commitments, getProject, updateProject, settings,
    getPlanSheetsForProject, getCalibrationForPlan, upsertPlanCalibration,
  } = useProjects();
  const { receipts } = useMaterialReceipts();
  const { seeds } = useCostSeeds();

  const project = useMemo(() => (projectId ? getProject(projectId) : null), [projectId, getProject]);
  const projectSheets = useMemo(
    () => (projectId ? getPlanSheetsForProject(projectId) : []),
    [projectId, getPlanSheetsForProject],
  );
  // There must be a linked estimate (with an items list) to append a priced line to.
  const canAddToEstimate = !!project?.linkedEstimate?.items;

  const [imageUri, setImageUri] = useState<string | null>(null);
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [imgLayout, setImgLayout] = useState<{ w: number; h: number } | null>(null);

  const [kind, setKind] = useState<Kind>('area');
  const [mode, setMode] = useState<Mode>('calibrate');

  const [calPoints, setCalPoints] = useState<NormPoint[]>([]);
  const [calibration, setCalibration] = useState<{ p1: NormPoint; p2: NormPoint; realDistanceFt: number } | null>(null);
  const [distanceModal, setDistanceModal] = useState(false);
  const [distanceInput, setDistanceInput] = useState('');

  const [drawPoints, setDrawPoints] = useState<NormPoint[]>([]);
  const [freehand, setFreehand] = useState(false);
  const [selectedTrade, setSelectedTrade] = useState<string | null>(null);
  const [lastAdded, setLastAdded] = useState<string | null>(null);

  // Waste factor applied to net measured quantity before pricing. Sensible
  // default; user-adjustable. Not applied to counts.
  const [wastePct, setWastePct] = useState(10);
  // Manual-rate fallback — the escape hatch from the cold-start dead-end.
  const [manualRate, setManualRate] = useState('');
  const [manualRateSource, setManualRateSource] = useState<string | null>(null); // engine category label, if filled from engine

  const unit = KIND_UNIT[kind];
  const needsScale = kind !== 'count';

  // Cold-start seeds (hooks/useCostSeeds) ride along so a contractor who
  // stated their rates can price a takeoff on day one instead of a catalog.
  const db = useMemo(() => buildCostDatabase(projects, commitments, receipts, [], seeds), [projects, commitments, receipts, seeds]);
  const trades = useMemo(() => tradesForUnit(db, unit), [db, unit]);
  const engineOptions = useMemo(
    () => engineRatesForUnit(typeof settings?.location === 'string' ? settings.location : '', unit),
    [settings?.location, unit],
  );

  const ftPerPx = useMemo(
    () => (calibration && imgLayout ? feetPerPixel(calibration, imgLayout.w, imgLayout.h) : null),
    [calibration, imgLayout],
  );

  // NET measured quantity, straight off the plan.
  const quantity = useMemo(() => {
    if (kind === 'count') return drawPoints.length;
    if (!ftPerPx || !imgLayout) return 0;
    if (kind === 'area') return drawPoints.length >= 3 ? polygonAreaSqFt(drawPoints, imgLayout.w, imgLayout.h, ftPerPx) : 0;
    return drawPoints.length >= 2 ? polylineLengthFt(drawPoints, imgLayout.w, imgLayout.h, ftPerPx) : 0;
  }, [kind, drawPoints, ftPerPx, imgLayout]);

  // Counts don't take waste; area/linear net qty gets a cut/waste allowance.
  const effectiveWaste = kind === 'count' ? 0 : wastePct / 100;
  // BILLABLE quantity = net × (1 + waste) — this is what we price and buy.
  const billableQuantity = useMemo(
    () => (quantity <= 0 ? 0 : kind === 'count' ? quantity : quantity * (1 + effectiveWaste)),
    [quantity, kind, effectiveWaste],
  );
  const billableRounded = unit === 'EA' ? billableQuantity : Math.round(billableQuantity);

  // Price the BILLABLE quantity from the GC's own history when a trade is picked.
  const pricing = useMemo(
    () => (selectedTrade && billableQuantity > 0 ? priceTakeoff(db, selectedTrade, unit, billableQuantity) : null),
    [db, selectedTrade, unit, billableQuantity],
  );

  // Effective rate: history rate wins when a matched trade is selected;
  // otherwise the manual/engine rate the user set. Either way, always priceable.
  const historyRate = pricing?.matched && pricing.rate != null ? pricing.rate : null;
  const manualRateNum = parseFloat(manualRate);
  const manualRateValid = Number.isFinite(manualRateNum) && manualRateNum > 0;
  const effectiveRate = historyRate ?? (manualRateValid ? manualRateNum : null);
  const effectiveAmount = effectiveRate != null && billableRounded > 0 ? billableRounded * effectiveRate : null;
  const effectiveSourceLabel = historyRate != null
    ? `${selectedTrade} · your history`
    : manualRateSource
      ? `${manualRateSource} · engine est.`
      : manualRateValid ? 'Manual rate' : null;

  const quantityLabel = useCallback((q: number) => {
    if (kind === 'area') return formatSqFt(q);
    if (kind === 'linear') return formatLinearFt(q);
    return `${q} EA`;
  }, [kind]);

  // ── image source ──────────────────────────────────────────────────────
  const resetForNewImage = useCallback((uri: string, sId: string | null, cal: typeof calibration) => {
    setImageUri(uri);
    setSheetId(sId);
    setCalibration(cal);
    setCalPoints([]);
    setDrawPoints([]);
    setLastAdded(null);
    setMode(cal || !needsScale ? 'draw' : 'calibrate');
  }, [needsScale]);

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
    resetForNewImage(result.assets[0].uri, null, null);
  }, [resetForNewImage]);

  const loadSheet = useCallback((sId: string, uri: string) => {
    const existing = getCalibrationForPlan(sId);
    resetForNewImage(
      uri,
      sId,
      existing ? { p1: existing.p1, p2: existing.p2, realDistanceFt: existing.realDistanceFt } : null,
    );
  }, [getCalibrationForPlan, resetForNewImage]);

  // ── touch ─────────────────────────────────────────────────────────────
  const onImageLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setImgLayout({ w: width, h: height });
  }, []);

  const toNorm = useCallback((ex: number, ey: number): NormPoint | null => {
    if (!imgLayout) return null;
    return { x: Math.max(0, Math.min(1, ex / imgLayout.w)), y: Math.max(0, Math.min(1, ey / imgLayout.h)) };
  }, [imgLayout]);

  const handleTap = useCallback((e: GestureResponderEvent) => {
    // In freehand mode the path is built on grant+move; ignore the release tap.
    if (freehand && mode === 'draw') return;
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
      setDrawPoints(prev => [...prev, pt]);
      setLastAdded(null);
    }
  }, [mode, toNorm, freehand]);

  // Freehand lasso — trace an area/line in one drag instead of tapping corners.
  const handleDrawGrant = useCallback((e: GestureResponderEvent) => {
    if (!freehand || mode !== 'draw') return;
    const pt = toNorm(e.nativeEvent.locationX, e.nativeEvent.locationY);
    if (!pt) return;
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    setDrawPoints([pt]);
    setLastAdded(null);
  }, [freehand, mode, toNorm]);

  const handleDrawMove = useCallback((e: GestureResponderEvent) => {
    if (!freehand || mode !== 'draw' || !imgLayout) return;
    const pt = toNorm(e.nativeEvent.locationX, e.nativeEvent.locationY);
    if (!pt) return;
    setDrawPoints(prev => {
      const last = prev[prev.length - 1];
      if (last) {
        const dx = (pt.x - last.x) * imgLayout.w;
        const dy = (pt.y - last.y) * imgLayout.h;
        if (dx * dx + dy * dy < 25) return prev; // throttle: skip moves < ~5px
      }
      return [...prev, pt];
    });
  }, [freehand, mode, toNorm, imgLayout]);

  const confirmDistance = useCallback(() => {
    const ft = parseFloat(distanceInput);
    if (calPoints.length === 2 && Number.isFinite(ft) && ft > 0) {
      const cal = { p1: calPoints[0], p2: calPoints[1], realDistanceFt: ft };
      setCalibration(cal);
      setMode('draw');
      // Persist scale back to the plan sheet so it's reused next time.
      if (sheetId && projectId) {
        upsertPlanCalibration({ planSheetId: sheetId, projectId, p1: cal.p1, p2: cal.p2, realDistanceFt: ft });
      }
    }
    setDistanceModal(false);
    setDistanceInput('');
  }, [distanceInput, calPoints, sheetId, projectId, upsertPlanCalibration]);

  const undoPoint = useCallback(() => {
    if (mode === 'calibrate') setCalPoints(prev => prev.slice(0, -1));
    else setDrawPoints(prev => prev.slice(0, -1));
  }, [mode]);

  const clearPoints = useCallback(() => {
    if (mode === 'calibrate') { setCalPoints([]); setCalibration(null); }
    else setDrawPoints([]);
  }, [mode]);

  const switchKind = useCallback((k: Kind) => {
    setKind(k);
    setDrawPoints([]);
    setSelectedTrade(null);
    setManualRate('');
    setManualRateSource(null);
    setLastAdded(null);
    if (k === 'count') setMode('draw');
    else if (!calibration) setMode('calibrate');
  }, [calibration]);

  // ── add to estimate (the loop-closer) ──────────────────────────────────
  // Works off the effective rate — history when available, otherwise the
  // manual/engine rate — so a measured quantity is never stranded.
  const handleAddToEstimate = useCallback(() => {
    if (!project?.linkedEstimate || effectiveRate == null || billableRounded <= 0) return;
    const est = project.linkedEstimate;
    const qty = billableRounded;
    const lineTotal = qty * effectiveRate;
    const usingHistory = historyRate != null && !!selectedTrade;
    const name = usingHistory
      ? `${selectedTrade} (takeoff)`
      : manualRateSource
        ? `${manualRateSource} (takeoff · engine rate)`
        : 'Takeoff line (manual rate)';
    const category = usingHistory ? (selectedTrade as string) : (manualRateSource ?? 'Takeoff');
    const item: LinkedEstimateItem = {
      materialId: generateUUID(),
      name,
      category,
      unit,
      quantity: qty,
      unitPrice: effectiveRate,
      bulkPrice: effectiveRate,
      markup: 0,
      usesBulk: false,
      lineTotal,
      supplier: '',
    };
    // Add markup at the estimate's existing effective ratio so permits /
    // contingency and current markup are preserved (don't recompute from scratch).
    const ratio = est.baseTotal > 0 ? est.markupTotal / est.baseTotal : 0;
    const addedMarkup = lineTotal * ratio;
    const next: LinkedEstimate = {
      ...est,
      items: [...est.items, item],
      baseTotal: est.baseTotal + lineTotal,
      markupTotal: est.markupTotal + addedMarkup,
      grandTotal: est.grandTotal + lineTotal + addedMarkup,
    };
    updateProject(project.id, commitEstimatePatch(project, next, { reason: 'manual', note: 'Added from visual takeoff' }));
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setLastAdded(`${quantityLabel(qty)} of ${category} · ${formatMoneyFull(lineTotal)}`);
    setDrawPoints([]);
    setManualRate('');
    setManualRateSource(null);
  }, [project, effectiveRate, billableRounded, historyRate, selectedTrade, manualRateSource, unit, updateProject, quantityLabel]);

  // ── render helpers ──────────────────────────────────────────────────────
  const px = (p: NormPoint) => ({ cx: p.x * (imgLayout?.w ?? 0), cy: p.y * (imgLayout?.h ?? 0) });
  const pointsStr = drawPoints.map(p => `${p.x * (imgLayout?.w ?? 0)},${p.y * (imgLayout?.h ?? 0)}`).join(' ');
  const labelPt = quantity > 0 && drawPoints.length > 0 ? centroid(drawPoints) : null;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
          <ChevronLeft size={22} color={t.text} strokeWidth={1.75} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.headerEyebrow}>Visual Takeoff · MAGE ID</Text>
          <Text style={styles.headerTitle} numberOfLines={1}>{project?.name ?? 'Trace & price'}</Text>
        </View>
        {imageUri ? (
          <TouchableOpacity onPress={pickImage} style={styles.headerBtn} hitSlop={12} accessibilityLabel="New image">
            <ImagePlus size={20} color={t.accent} strokeWidth={1.75} />
          </TouchableOpacity>
        ) : <View style={styles.headerBtn} />}
      </View>

      {!imageUri ? (
        <ScrollView contentContainerStyle={styles.empty} showsVerticalScrollIndicator={false}>
          <View style={[styles.emptyIcon, { backgroundColor: t.accent + '18' }]}>
            <PenTool size={34} color={t.accent} strokeWidth={1.6} />
          </View>
          <Text style={styles.emptyTitle}>Trace it, price it</Text>
          <Text style={styles.emptyMsg}>
            Pick a floor plan or a photo of one, set the scale with two taps, then trace an area,
            run a line, or drop counts. We&apos;ll size it and price it from your own cost database
            {canAddToEstimate ? ' — then add it straight to this estimate.' : '.'}
          </Text>

          {projectSheets.length > 0 && (
            <View style={styles.sheetList}>
              <Text style={styles.sheetListLabel}>Plans on this project</Text>
              {projectSheets.slice(0, 6).map(s => (
                <TouchableOpacity key={s.id} style={styles.sheetRow} onPress={() => loadSheet(s.id, s.imageUri)} activeOpacity={0.7} testID={`takeoff-sheet-${s.id}`}>
                  <FileImage size={18} color={t.accent} strokeWidth={1.75} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.sheetName} numberOfLines={1}>{s.name}</Text>
                    {getCalibrationForPlan(s.id) ? <Text style={styles.sheetCal}>scale saved · ready to trace</Text> : <Text style={styles.sheetCalMuted}>needs scale</Text>}
                  </View>
                  <ChevronLeft size={16} color={t.textMuted} style={{ transform: [{ rotate: '180deg' }] }} strokeWidth={1.75} />
                </TouchableOpacity>
              ))}
            </View>
          )}

          <TouchableOpacity style={styles.primaryBtn} onPress={pickImage} activeOpacity={0.85} testID="takeoff-pick">
            <ImagePlus size={18} color={Colors.textOnAccent} strokeWidth={1.75} />
            <Text style={styles.primaryBtnText}>Pick a plan or photo</Text>
          </TouchableOpacity>
        </ScrollView>
      ) : (
        <ScrollView {...fabScroll} contentContainerStyle={{ paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }} showsVerticalScrollIndicator={false}>
          {/* Kind toggle */}
          <View style={styles.kindRow}>
            <KindBtn active={kind === 'area'} icon={<Square size={14} color={kind === 'area' ? Colors.textOnAccent : t.text} strokeWidth={1.75} />} label="Area" onPress={() => switchKind('area')} t={t} styles={styles} />
            <KindBtn active={kind === 'linear'} icon={<Minus size={14} color={kind === 'linear' ? Colors.textOnAccent : t.text} strokeWidth={1.75} />} label="Linear" onPress={() => switchKind('linear')} t={t} styles={styles} />
            <KindBtn active={kind === 'count'} icon={<Hash size={14} color={kind === 'count' ? Colors.textOnAccent : t.text} strokeWidth={1.75} />} label="Count" onPress={() => switchKind('count')} t={t} styles={styles} />
          </View>

          {/* Mode toggle (scale not needed for count) */}
          {needsScale && (
            <View style={styles.modeRow}>
              <ModeBtn active={mode === 'calibrate'} icon={<Ruler size={15} color={mode === 'calibrate' ? Colors.textOnAccent : t.text} strokeWidth={1.75} />} label={calibration ? 'Scale set' : 'Set scale'} onPress={() => setMode('calibrate')} t={t} styles={styles} />
              <ModeBtn active={mode === 'draw'} icon={<PenTool size={15} color={mode === 'draw' ? Colors.textOnAccent : t.text} strokeWidth={1.75} />} label={kind === 'area' ? 'Trace area' : 'Run line'} onPress={() => setMode('draw')} disabled={!calibration} t={t} styles={styles} />
            </View>
          )}

          <Text style={styles.instruction}>
            {mode === 'calibrate'
              ? calibration ? 'Scale is set. Switch to draw.' : 'Tap two points a known distance apart (a door = 3 ft, a grid line, a dimension string).'
              : kind === 'area' ? (freehand ? 'Drag to trace the area in one stroke.' : 'Tap around the area to trace it (3+ points), or switch to Freehand.')
                : kind === 'linear' ? (freehand ? 'Drag along the run to measure it.' : 'Tap along the run to measure its length (2+ points), or switch to Freehand.')
                  : 'Tap each item to count it.'}
          </Text>

          {/* Canvas */}
          <View style={styles.canvasWrap}>
            <View
              style={styles.canvas}
              onLayout={onImageLayout}
              onStartShouldSetResponder={() => true}
              onMoveShouldSetResponder={() => freehand && mode === 'draw'}
              onResponderGrant={handleDrawGrant}
              onResponderMove={handleDrawMove}
              onResponderRelease={handleTap}
              testID="takeoff-canvas"
            >
              <Image source={{ uri: imageUri }} style={styles.image} resizeMode="contain" />
              {imgLayout && (
                <Svg style={StyleSheet.absoluteFill} width={imgLayout.w} height={imgLayout.h}>
                  {calPoints.length === 2 && (
                    <Line x1={px(calPoints[0]).cx} y1={px(calPoints[0]).cy} x2={px(calPoints[1]).cx} y2={px(calPoints[1]).cy} stroke={t.accentHot} strokeWidth={2} strokeDasharray="6,4" />
                  )}
                  {(mode === 'calibrate' ? calPoints : []).map((p, i) => (
                    <Circle key={`c${i}`} {...px(p)} r={6} fill={t.accentHot} stroke={Colors.textOnAccent} strokeWidth={1.5} />
                  ))}
                  {mode === 'draw' && kind === 'area' && drawPoints.length >= 2 && (
                    <SvgPolygon points={pointsStr} fill={t.accent + '33'} stroke={t.accent} strokeWidth={2} />
                  )}
                  {mode === 'draw' && kind === 'linear' && drawPoints.length >= 2 && (
                    <SvgPolyline points={pointsStr} fill="none" stroke={t.accent} strokeWidth={2.5} />
                  )}
                  {(mode === 'draw' ? drawPoints : []).map((p, i) => (
                    <Circle key={`a${i}`} {...px(p)} r={5} fill={t.accent} stroke={Colors.textOnAccent} strokeWidth={1.5} />
                  ))}
                </Svg>
              )}
              {labelPt && (
                <View style={[styles.areaLabel, { left: `${labelPt.x * 100}%`, top: `${labelPt.y * 100}%` }]} pointerEvents="none">
                  <Text style={styles.areaLabelText}>{quantityLabel(kind === 'count' ? drawPoints.length : Math.round(quantity))}</Text>
                </View>
              )}
            </View>

            <View style={styles.canvasTools}>
              {mode === 'draw' && kind !== 'count' && (
                <TouchableOpacity style={styles.toolBtn} onPress={() => { setFreehand(f => !f); setDrawPoints([]); setLastAdded(null); }} hitSlop={8} testID="takeoff-freehand">
                  <Spline size={16} color={freehand ? t.accent : t.text} strokeWidth={1.75} />
                  <Text style={[styles.toolText, freehand && { color: t.accent }]}>{freehand ? 'Freehand' : 'Tap to place'}</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.toolBtn} onPress={undoPoint} hitSlop={8} testID="takeoff-undo"><Undo2 size={16} color={t.text} strokeWidth={1.75} /><Text style={styles.toolText}>Undo</Text></TouchableOpacity>
              <TouchableOpacity style={styles.toolBtn} onPress={clearPoints} hitSlop={8} testID="takeoff-clear"><Trash2 size={16} color={t.danger} strokeWidth={1.75} /><Text style={[styles.toolText, { color: t.danger }]}>Clear</Text></TouchableOpacity>
            </View>
          </View>

          {/* Result */}
          <View style={styles.result}>
            {needsScale && !calibration ? (
              <Text style={styles.resultHint}>Set the scale to size your takeoff.</Text>
            ) : quantity <= 0 ? (
              <Text style={styles.resultHint}>
                {kind === 'area' ? 'Trace an area (3+ points) to size it.' : kind === 'linear' ? 'Run a line (2+ points) to measure it.' : 'Tap items to count them.'}
              </Text>
            ) : (
              <>
                <View style={styles.resultHead}>
                  <Text style={styles.resultArea}>{quantityLabel(kind === 'count' ? quantity : Math.round(quantity))}</Text>
                  {effectiveAmount != null && (
                    <Text style={styles.resultPrice}>{formatMoneyFull(effectiveAmount)}</Text>
                  )}
                </View>

                {/* Waste factor — net measured qty → billable qty (not for counts) */}
                {kind !== 'count' && (
                  <View style={styles.wasteBlock}>
                    <View style={styles.wasteHeadRow}>
                      <Text style={styles.pickLabel}>Waste factor</Text>
                      <Text style={styles.wasteQtyText}>
                        {quantityLabel(Math.round(quantity))} net → <Text style={styles.wasteQtyStrong}>{quantityLabel(billableRounded)}</Text> billable
                      </Text>
                    </View>
                    <View style={styles.wastePills}>
                      {[0, 5, 10, 15, 20].map(w => (
                        <TouchableOpacity
                          key={w}
                          style={[styles.wastePill, wastePct === w && styles.wastePillActive]}
                          onPress={() => setWastePct(w)}
                          activeOpacity={0.8}
                          testID={`takeoff-waste-${w}`}
                        >
                          <Text style={[styles.wastePillText, wastePct === w && styles.wastePillTextActive]}>{w}%</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                )}

                {/* Price from YOUR history when available */}
                {trades.length > 0 && (
                  <>
                    <Text style={styles.pickLabel}>Price from your history</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 2 }}>
                      {trades.map(e => {
                        const sel = selectedTrade === e.trade;
                        return (
                          <TouchableOpacity
                            key={e.key}
                            style={[styles.chip, sel && { backgroundColor: t.accent, borderColor: t.accent }]}
                            onPress={() => { setSelectedTrade(sel ? null : e.trade); setManualRate(''); setManualRateSource(null); }}
                            activeOpacity={0.8}
                            testID={`takeoff-trade-${e.key}`}
                          >
                            <Text style={[styles.chipText, sel && { color: Colors.textOnAccent }]}>{e.trade}</Text>
                            <Text style={[styles.chipRate, sel && { color: Colors.textOnAccent }]}>${e.suggestedRate.toFixed(2)}/{unit}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </ScrollView>
                  </>
                )}

                {/* Manual / engine-rate fallback — always available, so a measured
                    quantity is never a dead-end even with zero closed-job history. */}
                {historyRate == null && (
                  <View style={styles.manualBlock}>
                    <Text style={styles.pickLabel}>
                      {trades.length > 0 ? 'Or set a rate' : 'Set a rate'}
                    </Text>
                    <View style={styles.manualRow}>
                      <Text style={styles.manualDollar}>$</Text>
                      <TextInput
                        style={styles.manualInput}
                        value={manualRate}
                        onChangeText={(v) => { setManualRate(v); setManualRateSource(null); if (v) setSelectedTrade(null); }}
                        keyboardType="decimal-pad"
                        placeholder="0.00"
                        placeholderTextColor={t.textMuted}
                        testID="takeoff-manual-rate"
                      />
                      <Text style={styles.manualUnit}>/ {unit}</Text>
                    </View>
                    {engineOptions.length > 0 && (
                      <>
                        <View style={styles.engineHintRow}>
                          <Calculator size={12} color={t.accent} strokeWidth={2} />
                          <Text style={styles.engineHintText}>Or use a regional engine rate (material + labor + waste):</Text>
                        </View>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 2 }}>
                          {engineOptions.map(opt => {
                            const sel = manualRateSource === opt.label;
                            return (
                              <TouchableOpacity
                                key={opt.category}
                                style={[styles.chip, sel && { backgroundColor: t.accent, borderColor: t.accent }]}
                                onPress={() => { setManualRate(opt.rate.toFixed(2)); setManualRateSource(opt.label); setSelectedTrade(null); }}
                                activeOpacity={0.8}
                                testID={`takeoff-engine-${opt.category}`}
                              >
                                <Text style={[styles.chipText, sel && { color: Colors.textOnAccent }]}>{opt.label}</Text>
                                <Text style={[styles.chipRate, sel && { color: Colors.textOnAccent }]}>${opt.rate.toFixed(2)}/{unit}</Text>
                              </TouchableOpacity>
                            );
                          })}
                        </ScrollView>
                      </>
                    )}
                  </View>
                )}

                {/* Effective price detail */}
                {effectiveRate != null && effectiveAmount != null && (
                  <View style={styles.priceDetail}>
                    <Text style={styles.priceLine}>{quantityLabel(billableRounded)} × ${effectiveRate.toFixed(2)}/{unit}</Text>
                    {effectiveSourceLabel && <Text style={styles.priceRange}>Rate source: {effectiveSourceLabel}</Text>}
                    {historyRate != null && pricing?.low != null && pricing?.high != null && (
                      <Text style={styles.priceRange}>Range {formatMoneyFull(pricing.low)}–{formatMoneyFull(pricing.high)} · {pricing.confidence} confidence ({pricing.entry?.jobCount} job{pricing.entry?.jobCount === 1 ? '' : 's'})</Text>
                    )}
                  </View>
                )}

                {/* Add to estimate — the loop-closer */}
                {canAddToEstimate && effectiveRate != null && (
                  <TouchableOpacity style={styles.addBtn} onPress={handleAddToEstimate} activeOpacity={0.85} testID="takeoff-add-to-estimate">
                    <Plus size={16} color={Colors.textOnAccent} strokeWidth={1.75} />
                    <Text style={styles.addBtnText}>Add to {project?.name ? 'this estimate' : 'estimate'}</Text>
                  </TouchableOpacity>
                )}
                {!canAddToEstimate && effectiveRate != null && (
                  <Text style={styles.resultHintSmall}>Open this from a project (with a cost-and-markup estimate) to add the line directly.</Text>
                )}
              </>
            )}

            {lastAdded && (
              <View style={styles.added}>
                <CheckCircle2 size={16} color={t.success} strokeWidth={1.75} />
                <Text style={styles.addedText}>Added {lastAdded} to the estimate. Trace another, or change kind.</Text>
              </View>
            )}
          </View>

          <TouchableOpacity style={styles.crossLink} onPress={() => router.push('/cost-database' as any)} activeOpacity={0.7} testID="takeoff-costdb-link">
            <Library size={16} color={t.accent} strokeWidth={1.75} />
            <Text style={styles.crossLinkText}>Rates come from your Cost Database</Text>
          </TouchableOpacity>

          <Text style={styles.note}>
            Area/linear quantities use the plan&apos;s calibration (two points + a known distance);
            count needs no scale. A waste factor is applied to the net measured quantity before
            pricing. Price from your own learned rate when you have history, or fall back to a
            regional engine rate / a rate you type — so a measurement is never a dead-end. Adding to
            the estimate writes a priced line, and that job&apos;s actuals later sharpen these rates.
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
                <Check size={16} color={Colors.textOnAccent} strokeWidth={1.75} />
                <Text style={styles.modalConfirmText}>Set scale</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function KindBtn({ active, icon, label, onPress, t, styles }: {
  active: boolean; icon: React.ReactNode; label: string; onPress: () => void;
  t: ThemeColors; styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <TouchableOpacity style={[styles.kindBtn, active && { backgroundColor: t.accentFill, borderColor: t.accent }]} onPress={onPress} activeOpacity={0.8}>
      {icon}
      <Text style={[styles.kindBtnText, active && { color: Colors.textOnAccent }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function ModeBtn({ active, icon, label, onPress, disabled, t, styles }: {
  active: boolean; icon: React.ReactNode; label: string; onPress: () => void; disabled?: boolean;
  t: ThemeColors; styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <TouchableOpacity style={[styles.modeBtn, active && { backgroundColor: t.accentFill, borderColor: t.accent }, disabled && { opacity: 0.4 }]} onPress={onPress} disabled={disabled} activeOpacity={0.8}>
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
  headerTitle: { ...Type.serifHeadline, color: t.text },

  empty: { alignItems: 'center' as const, justifyContent: 'center' as const, padding: 36, gap: 14, flexGrow: 1 },
  emptyIcon: { width: 76, height: 76, borderRadius: Tokens.radius.panel, alignItems: 'center' as const, justifyContent: 'center' as const },
  emptyTitle: { fontSize: Type.title3.fontSize, fontWeight: '800' as const, color: t.text },
  emptyMsg: { fontSize: Type.subhead.fontSize, color: t.textSecondary, textAlign: 'center' as const, lineHeight: 21, maxWidth: 340 },
  sheetList: { alignSelf: 'stretch' as const, gap: 6, marginTop: 4 },
  sheetListLabel: { fontSize: Type.caption2.fontSize, color: t.textMuted, fontWeight: '700' as const, letterSpacing: 0.3, marginBottom: 2 },
  sheetRow: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10,
    backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, borderRadius: Tokens.radius.card, padding: 12,
  },
  sheetName: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: t.text },
  sheetCal: { fontSize: Type.caption2.fontSize, color: t.success },
  sheetCalMuted: { fontSize: Type.caption2.fontSize, color: t.textMuted },
  primaryBtn: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8,
    backgroundColor: t.accentFill, paddingHorizontal: 22, paddingVertical: 13, borderRadius: Tokens.radius.lg, marginTop: 6,
  },
  primaryBtnText: { color: Colors.textOnAccent, fontSize: Type.callout.fontSize, fontWeight: '700' as const },

  kindRow: { flexDirection: 'row' as const, gap: 8, paddingHorizontal: 16, paddingTop: 14 },
  kindBtn: {
    flex: 1, flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 5,
    backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, borderRadius: Tokens.radius.sm, paddingVertical: 9,
  },
  kindBtnText: { fontSize: Type.caption1.fontSize, fontWeight: '700' as const, color: t.text },

  modeRow: { flexDirection: 'row' as const, gap: 10, paddingHorizontal: 16, paddingTop: 10 },
  modeBtn: {
    flex: 1, flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 6,
    backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, borderRadius: Tokens.radius.card, paddingVertical: 11,
  },
  modeBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: t.text },

  instruction: { fontSize: Type.caption1.fontSize, color: t.textSecondary, paddingHorizontal: 16, marginTop: 10, marginBottom: 10, lineHeight: 17 },

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
  resultHintSmall: { fontSize: Type.caption1.fontSize, color: t.textMuted, lineHeight: 17 },
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

  wasteBlock: { gap: 6 },
  wasteHeadRow: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, gap: 8 },
  wasteQtyText: { fontSize: Type.caption1.fontSize, color: t.textSecondary },
  wasteQtyStrong: { fontWeight: '800' as const, color: t.text },
  wastePills: { flexDirection: 'row' as const, gap: 6 },
  wastePill: {
    flex: 1, alignItems: 'center' as const, paddingVertical: 7,
    borderRadius: Tokens.radius.sm, borderWidth: 1, borderColor: t.line, backgroundColor: t.surfaceAlt,
  },
  wastePillActive: { backgroundColor: t.accentFill, borderColor: t.accent },
  wastePillText: { fontSize: Type.caption1.fontSize, fontWeight: '700' as const, color: t.text },
  wastePillTextActive: { color: Colors.textOnAccent },

  manualBlock: { gap: 6 },
  manualRow: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6,
    borderWidth: 1, borderColor: t.line, borderRadius: Tokens.radius.sm,
    backgroundColor: t.surfaceAlt, paddingHorizontal: 12, paddingVertical: 4,
  },
  manualDollar: { fontSize: Type.headline.fontSize, fontWeight: '800' as const, color: t.textSecondary },
  manualInput: { flex: 1, fontSize: Type.headline.fontSize, fontWeight: '700' as const, color: t.text, paddingVertical: 8 },
  manualUnit: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: t.textSecondary },
  engineHintRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 5, marginTop: 2 },
  engineHintText: { flex: 1, fontSize: Type.caption2.fontSize, color: t.textMuted },

  addBtn: {
    flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 7,
    backgroundColor: t.accentFill, borderRadius: Tokens.radius.card, paddingVertical: 12, marginTop: 4,
  },
  addBtnText: { color: Colors.textOnAccent, fontSize: Type.callout.fontSize, fontWeight: '700' as const },

  added: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8,
    backgroundColor: t.success + '14', borderRadius: Tokens.radius.card, padding: 11, marginTop: 2,
  },
  addedText: { flex: 1, fontSize: Type.caption1.fontSize, color: t.textSecondary, lineHeight: 17 },

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
  modalConfirm: { flex: 1, flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 6, paddingVertical: 12, borderRadius: Tokens.radius.sm, backgroundColor: t.accentFill },
  modalConfirmText: { fontSize: Type.callout.fontSize, fontWeight: '700' as const, color: Colors.textOnAccent },
});
