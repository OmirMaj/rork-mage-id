// components/takeoff/TakeoffWorkspace.tsx — the desktop web takeoff (wave 4,
// lane T2). app/area-takeoff.tsx mounts this INSTEAD of the phone flow when
// useIsDesktopWeb(); the iPhone, a tablet and a narrow browser never see it.
//
//   [ top bar 48: back · job › Takeoff · sheet · scale pill ·· Push N lines ]
//   [ sheet rail 220 ][ canvas (flex) ][ Conditions 360 ]
//
// The drawing is the hero (Togal / STACK): a grayscale sheet with real zoom
// and pan, shapes in their condition's colour, and one live list whose
// swatches match the shapes. The takeoff and the estimate are one object:
// "Push N lines to estimate" UPDATES the lines it wrote last time instead of
// duplicating them (utils/takeoff/conditionPush — T1's money contract).
//
// State: the takeoff doc (conditions + measurements) lives per job in this
// browser (hooks/useTakeoffConditions, a mageid_* key — the panel says "Saved
// on this browser"); the sheet scale is the SAME store plan-viewer and the
// phone use (upsertPlanCalibration). Each measurement carries its sheet's
// aspect, so "All sheets" totals never need another sheet's image.
//
// HOTKEYS: the condition editor and the scale dialog mount ONLY while open
// (`{editor ? <ConditionEditor/> : null}`), because an open dialog scope is
// exclusive (hooks/useHotkeys) and a closed-but-mounted one would kill every
// canvas key below.
//
// LIST-3 LANE TK-a: starter chips on an empty takeoff (utils/takeoff/
// starterConditions, by the job's type label), the conditions filter ('/'
// focuses it, Esc in it clears it), 1–9 activate the Nth VISIBLE row
// (ConditionsPanel.visibleRows — the same rows he sees), hover a row to
// thicken its shapes, per-measurement sub-rows (click → select + fit, on
// another sheet after it opens: pendingFocus), and vertex dragging (the canvas
// previews; onMoveVertex writes once = one undo entry).

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronLeft, PanelLeftOpen, PanelRightOpen } from 'lucide-react-native';
import { Sheet } from '@/components/ui';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { targetWithin, useHotkeys, usePrimaryAction, type HotkeyBinding } from '@/hooks/useHotkeys';
import { useProjects } from '@/contexts/ProjectContext';
import { useMaterialReceipts } from '@/hooks/useMaterialReceipts';
import { useCostSeeds } from '@/hooks/useCostSeeds';
import { useTakeoffConditions } from '@/hooks/useTakeoffConditions';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';
import type { ThemeColors } from '@/constants/colors';
import { Layout, Tokens } from '@/constants/designTokens';
import { Type } from '@/constants/typography';
import PlanSheetRail from '@/components/plans/PlanSheetRail';
import { railSheets, adjacentSheetId } from '@/utils/plans/planRail';
import { useLocalPlanSheetUri } from '@/utils/planSheetLocalFiles';
import { planScaleStatus, stampImageFrame, usableCalibration, PLAN_SCALE_RECHECK_COPY } from '@/utils/planScale';
import { buildCostDatabase } from '@/utils/costDatabase';
import { estimateProjectCandidates, parseDecimalInput, pickEstimateProject } from '@/utils/estimateLanding';
import { commitEstimatePatch } from '@/utils/estimateCommit';
import { formatMoneyFull } from '@/utils/jobCostEngine';
import { generateUUID } from '@/utils/generateId';
import { formatLinearFt, formatSqFt, type NormPoint } from '@/utils/takeoffGeometry';
import {
  KIND_UNIT, defaultConditionColor, measurementQuantity, rollup,
  type ConditionKind, type SheetCal, type TakeoffCondition, type TakeoffMeasurement,
} from '@/utils/takeoff/conditions';
import { resolveStarterTrade, starterConditionsFor, starterRateLine } from '@/utils/takeoff/starterConditions';
import { projectTypeLabel } from '@/utils/projectTypes';
import { fitRect, fitToPoints, zoomAt, IDENTITY_VIEW, type ViewT } from '@/utils/takeoff/viewTransform';
import { applyTakeoffPush, pushBlockReason, pushLinesFrom } from '@/utils/takeoff/conditionPush';
import {
  conditionFromSuggestion, suggestionsFromTakeoff, takenSuggestionKeys, type AiSuggestion,
} from '@/utils/takeoff/aiSuggestions';
import { useSavedAiTakeoff } from '@/hooks/useSavedAiTakeoff';
import TakeoffCanvas, { type CanvasShape, type TakeoffTool } from './TakeoffCanvas';
import ConditionsPanel, {
  TAKEOFF_FILTER_DOM_ID, visibleRows,
  type MeasurementSubRow, type PanelFilter, type StarterChip,
} from './ConditionsPanel';
import ConditionEditor from './ConditionEditor';
import TakeoffFirstRun from './TakeoffFirstRun';
import RailDropZone, { useTakeoffPdfDrop } from './RailDropZone';

const RAIL_OPEN_KEY = 'mageid_takeoff_rail_open';
const PANEL_OPEN_KEY = 'mageid_takeoff_panel_open';
/** Below this width the sheet rail starts collapsed (the canvas needs the room). */
const RAIL_AUTO_OPEN_MIN_WIDTH = 1280;

/** Sheet image aspect (width / height), keyed `${sheet.id}|${uri}` — read once per session. */
const ASPECT_CACHE = new Map<string, number>();

const SIZE_READING = 'Reading the sheet size…';
const SIZE_FAILED = 'Couldn’t read this sheet’s image — measuring is off for it.';

const money = (n: number) => formatMoneyFull(n);
const DRAW_KINDS: readonly TakeoffTool[] = ['area', 'linear', 'count'];

function qtyLabel(kind: ConditionKind, q: number | null): string {
  if (q == null) return 'not measured';
  if (kind === 'area') return formatSqFt(q);
  if (kind === 'linear') return formatLinearFt(q);
  return `${q} EA`;
}

export default function TakeoffWorkspace() {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { width } = useResponsiveLayout();
  const { projectId: paramProjectId } = useLocalSearchParams<{ projectId?: string }>();
  const {
    projects, commitments, getProject, updateProject,
    getPlanSheetsForProject, getCalibrationForPlan, upsertPlanCalibration,
  } = useProjects();
  const { receipts } = useMaterialReceipts();
  const { seeds } = useCostSeeds();
  const sheetUri = useLocalPlanSheetUri();

  // ── the job (the phone screen's fallback, exactly) ─────────────────────
  const estimateJobs = useMemo(() => estimateProjectCandidates(projects), [projects]);
  const fallback = useMemo(
    () => (paramProjectId ? null : pickEstimateProject(projects, 'estimate')),
    [paramProjectId, projects],
  );
  const projectId = paramProjectId ?? fallback?.id ?? null;
  useEffect(() => {
    if (!paramProjectId && fallback) router.setParams({ projectId: fallback.id });
  }, [paramProjectId, fallback, router]);
  const pickProject = useCallback((id: string) => router.setParams({ projectId: id }), [router]);
  const project = useMemo(() => (projectId ? getProject(projectId) ?? null : null), [projectId, getProject]);
  const db = useMemo(() => buildCostDatabase(projects, commitments, receipts, [], seeds), [projects, commitments, receipts, seeds]);

  // ── sheets ─────────────────────────────────────────────────────────────
  const projectSheets = useMemo(() => (projectId ? getPlanSheetsForProject(projectId) : []), [projectId, getPlanSheetsForProject]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = useMemo(
    () => projectSheets.find((s) => s.id === activeId) ?? railSheets(projectSheets, '')[0] ?? null,
    [projectSheets, activeId],
  );
  const rail = useMemo(() => (active ? railSheets(projectSheets, active.id) : []), [projectSheets, active]);
  const uri = active ? sheetUri(active) : null;
  const sheetLabel = useCallback((id: string) => {
    const s = projectSheets.find((x) => x.id === id);
    return s ? (s.sheetNumber || s.name) : 'another sheet';
  }, [projectSheets]);

  // ── the active sheet's aspect (Image.getSize; cached per sheet+uri) ────
  const aspectKey = active && uri ? `${active.id}|${uri}` : null;
  const [aspectRead, setAspectRead] = useState<{ key: string; value: number | 'error' } | null>(null);
  useEffect(() => {
    if (!aspectKey || !uri) return undefined;
    const hit = ASPECT_CACHE.get(aspectKey);
    if (hit) { setAspectRead({ key: aspectKey, value: hit }); return undefined; }
    let live = true;
    try {
      Image.getSize(
        uri,
        (w, h) => {
          const v = w > 0 && h > 0 ? w / h : null;
          if (v) ASPECT_CACHE.set(aspectKey, v);
          if (live) setAspectRead({ key: aspectKey, value: v ?? 'error' });
        },
        () => { if (live) setAspectRead({ key: aspectKey, value: 'error' }); },
      );
    } catch {
      setAspectRead({ key: aspectKey, value: 'error' });
    }
    return () => { live = false; };
  }, [aspectKey, uri]);
  const aspect = aspectRead && aspectRead.key === aspectKey && typeof aspectRead.value === 'number' ? aspectRead.value : null;
  const aspectFailed = !!active && (!uri || (aspectRead?.key === aspectKey && aspectRead.value === 'error'));

  // ── the doc ────────────────────────────────────────────────────────────
  const tk = useTakeoffConditions(projectId);
  const drop = useTakeoffPdfDrop(projectId);
  const { doc, loaded, update, record, undo, redo, saveLine, conflict } = tk;
  const calFor = useCallback((sheetId: string): SheetCal | null => {
    const u = usableCalibration(getCalibrationForPlan(sheetId));
    return u ? { p1: u.p1, p2: u.p2, realDistanceFt: u.realDistanceFt } : null;
  }, [getCalibrationForPlan]);
  const [filter, setFilter] = useState<PanelFilter>('sheet');
  const rollupAll = useMemo(() => rollup(doc, db, calFor), [doc, db, calFor]);
  const panelRows = useMemo(
    () => (filter === 'sheet' && active ? rollup(doc, db, calFor, active.id).rows : rollupAll.rows),
    [filter, active, doc, db, calFor, rollupAll],
  );
  // The filter box (the panel shows visibleRows of it; 1–9 read the same rows).
  const [filterText, setFilterText] = useState('');
  const shownRows = useMemo(() => visibleRows(panelRows, filterText), [panelRows, filterText]);
  const filterRef = useRef<TextInput>(null);
  // The condition whose row is hovered: its shapes draw thick.
  const [hoverCondId, setHoverCondId] = useState<string | null>(null);
  const colorOf = useMemo(() => new Map(doc.conditions.map((c) => [c.id, c.color])), [doc.conditions]);
  // Conditions drawn on any sheet (the AI-read subline on This sheet reads it).
  const drawnAnywhere = useMemo(() => new Set(doc.measurements.map((m) => m.conditionId)), [doc.measurements]);
  const [activeCondId, setActiveCondId] = useState<string | null>(null);
  const activeCond = doc.conditions.find((c) => c.id === activeCondId) ?? null;

  // ── AI suggestions (lane TK-b): the AI Takeoff saved on this browser ───
  // Read-only and free: no AI runs here. A suggestion is not a condition — it
  // is never drawn and never reaches the rollup, the cost line or the push
  // until he accepts it (then it is a condition labelled "AI read — not measured").
  const aiSaved = useSavedAiTakeoff(projectId);
  // /area-takeoff stays mounted under /takeoff ("Run AI Takeoff" pushes it), so
  // re-read on every return to this screen — else the panel keeps saying
  // "nothing saved" (or shows the last run) until a page reload. The first
  // focus is the mount, which the hook already reads.
  const aiReload = aiSaved.reload;
  const aiFocusSeen = useRef(false);
  useFocusEffect(useCallback(() => {
    if (aiFocusSeen.current) aiReload();
    aiFocusSeen.current = true;
  }, [aiReload]));
  const aiTaken = useMemo(() => takenSuggestionKeys(doc), [doc]);
  const aiSug = useMemo(
    () => (aiSaved.saved ? suggestionsFromTakeoff(aiSaved.saved, aiTaken) : { rows: [] as AiSuggestion[], skipped: [] }),
    [aiSaved.saved, aiTaken],
  );

  // ── canvas state ───────────────────────────────────────────────────────
  const [tool, setTool] = useState<TakeoffTool>('select');
  const [draftPts, setDraftPts] = useState<NormPoint[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<ViewT>(IDENTITY_VIEW);
  const [canvasSize, setCanvasSize] = useState<{ w: number; h: number } | null>(null);
  const [grayscale, setGrayscale] = useState(true);
  const [scaleDraft, setScaleDraft] = useState<{ p1: NormPoint; p2: NormPoint } | null>(null);
  const [editor, setEditor] = useState<{ id: string | null; kind: ConditionKind } | null>(null);
  const paper = useMemo(() => (canvasSize && aspect ? fitRect(canvasSize, aspect) : null), [canvasSize, aspect]);
  const onCanvasSize = useCallback((s: { w: number; h: number }) => {
    setCanvasSize((prev) => (prev && prev.w === s.w && prev.h === s.h ? prev : s));
  }, []);

  const toolsOffReason = !active
    ? null
    : !loaded ? 'Loading this job’s takeoff…'
      : aspectFailed ? SIZE_FAILED
        : aspect == null ? SIZE_READING
          : null;

  // A new sheet starts clean: no half-drawn shape, no selection, fitted.
  const openSheet = useCallback((id: string) => {
    setActiveId(id);
    setDraftPts([]);
    setSelectedId(null);
    setView(IDENTITY_VIEW);
  }, []);
  useEffect(() => { setDraftPts([]); setSelectedId(null); setActiveCondId(null); setActiveId(null); setView(IDENTITY_VIEW); }, [projectId]);

  const sheetMeasurements = useMemo(
    () => (active ? doc.measurements.filter((m) => m.sheetId === active.id) : []),
    [doc.measurements, active],
  );
  const activeCal = active ? calFor(active.id) : null;
  const shapes = useMemo<CanvasShape[]>(() => sheetMeasurements.map((m) => ({
    id: m.id,
    conditionId: m.conditionId,
    kind: m.kind,
    points: m.points,
    color: colorOf.get(m.conditionId) ?? t.textMuted,
    label: m.kind === 'count' ? null : qtyLabel(m.kind, measurementQuantity(m, activeCal)),
  })), [sheetMeasurements, colorOf, activeCal, t.textMuted]);

  // ── rail / panel open (remembered in this browser) ─────────────────────
  const [railOpen, setRailOpen] = useState(width >= RAIL_AUTO_OPEN_MIN_WIDTH);
  const [panelOpen, setPanelOpen] = useState(true);
  useEffect(() => {
    let live = true;
    void (async () => {
      let r: string | null = null;
      let p: string | null = null;
      try { r = await AsyncStorage.getItem(RAIL_OPEN_KEY); p = await AsyncStorage.getItem(PANEL_OPEN_KEY); } catch { /* a per-viewer convenience */ }
      if (!live) return;
      if (r != null) setRailOpen(r !== 'false');
      if (p != null) setPanelOpen(p !== 'false');
    })();
    return () => { live = false; };
  }, []);
  const remember = (key: string, open: boolean) => {
    void (async () => { try { await AsyncStorage.setItem(key, open ? 'true' : 'false'); } catch { /* not remembered; still toggles */ } })();
  };
  const toggleRail = useCallback(() => setRailOpen((o) => { remember(RAIL_OPEN_KEY, !o); return !o; }), []);
  const togglePanel = useCallback(() => setPanelOpen((o) => { remember(PANEL_OPEN_KEY, !o); return !o; }), []);

  // ── tools ──────────────────────────────────────────────────────────────
  const chooseTool = useCallback((tt: TakeoffTool) => {
    setDraftPts([]);
    if (DRAW_KINDS.includes(tt)) {
      if (toolsOffReason) return;
      const kind = tt as ConditionKind;
      if (activeCond?.kind === kind) setTool(tt);
      else setEditor({ id: null, kind });
      return;
    }
    if (tt === 'scale' && toolsOffReason) return;
    setTool(tt);
  }, [toolsOffReason, activeCond]);

  const addMeasurement = useCallback((kind: ConditionKind, points: NormPoint[]) => {
    if (!active || !activeCond || !aspect) return;
    const m: TakeoffMeasurement = {
      id: generateUUID(), conditionId: activeCond.id, sheetId: active.id, kind, points,
      createdAt: new Date().toISOString(), aspect,
    };
    update((d) => ({ ...d, measurements: [...d.measurements, m] }));
  }, [active, activeCond, aspect, update]);

  const onAddPoint = useCallback((n: NormPoint) => {
    if (tool === 'scale') {
      if (draftPts.length >= 1) { setScaleDraft({ p1: draftPts[0], p2: n }); setDraftPts([]); }
      else setDraftPts([n]);
      return;
    }
    if (!activeCond || activeCond.kind !== tool) return;
    if (tool === 'count') { addMeasurement('count', [n]); return; }
    setDraftPts((p) => [...p, n]);
  }, [tool, draftPts, activeCond, addMeasurement]);

  const canFinish = (tool === 'area' && draftPts.length >= 3) || (tool === 'linear' && draftPts.length >= 2);
  const finish = useCallback(() => {
    if (!canFinish) return;
    addMeasurement(tool as ConditionKind, draftPts);
    setDraftPts([]);
  }, [canFinish, tool, draftPts, addMeasurement]);

  const deleteSelected = useCallback(() => {
    if (!selectedId) return;
    const id = selectedId;
    update((d) => ({ ...d, measurements: d.measurements.filter((m) => m.id !== id) }));
    setSelectedId(null);
  }, [selectedId, update]);

  const onSelect = useCallback((id: string | null) => {
    setSelectedId(id);
    const m = id ? doc.measurements.find((x) => x.id === id) : null;
    if (m) setActiveCondId(m.conditionId);
  }, [doc.measurements]);

  // A vertex drag released on the sheet: ONE update = one undo entry.
  const onMoveVertex = useCallback((id: string, index: number, point: NormPoint) => {
    update((d) => ({
      ...d,
      measurements: d.measurements.map((m) => (m.id === id ? { ...m, points: m.points.map((q, i) => (i === index ? point : q)) } : m)),
    }));
  }, [update]);

  // A sub-row's delete: undoable, and the selection goes with it.
  const deleteMeasurement = useCallback((id: string) => {
    update((d) => ({ ...d, measurements: d.measurements.filter((m) => m.id !== id) }));
    setSelectedId((s) => (s === id ? null : s));
  }, [update]);

  // ── zoom ───────────────────────────────────────────────────────────────
  const zoomBy = useCallback((f: number) => {
    if (!canvasSize) return;
    setView((v) => zoomAt(v, f, canvasSize.w / 2, canvasSize.h / 2, paper ?? undefined));
  }, [canvasSize, paper]);
  const fitTo = useCallback((pts: NormPoint[]) => {
    if (!canvasSize || !paper || pts.length === 0) { setView(IDENTITY_VIEW); return; }
    setView(fitToPoints(canvasSize, paper, pts));
  }, [canvasSize, paper]);
  const fit = useCallback(() => fitTo(sheetMeasurements.flatMap((m) => m.points)), [fitTo, sheetMeasurements]);

  // ── sub-rows: click → select it and fit to it ─────────────────────────
  // On another sheet, open that sheet first: openSheet resets the view, and the
  // new sheet's paper exists only once its size is read, so the fit waits in
  // pendingFocus until active.id and paper match.
  const [pendingFocus, setPendingFocus] = useState<string | null>(null);
  const pickMeasurement = useCallback((id: string) => {
    const m = doc.measurements.find((x) => x.id === id);
    if (!m) return;
    setDraftPts([]);
    setTool('select');
    if (active && m.sheetId === active.id) {
      setPendingFocus(null);
      onSelect(id);
      fitTo(m.points);
      return;
    }
    openSheet(m.sheetId);
    setActiveCondId(m.conditionId);
    setPendingFocus(id);
  }, [doc.measurements, active, onSelect, fitTo, openSheet]);
  useEffect(() => {
    if (!pendingFocus || !active || !paper) return;
    const m = doc.measurements.find((x) => x.id === pendingFocus);
    if (!m) { setPendingFocus(null); return; }
    if (m.sheetId !== active.id) return;
    setPendingFocus(null);
    setSelectedId(m.id);
    setActiveCondId(m.conditionId);
    fitTo(m.points);
  }, [pendingFocus, active, paper, doc.measurements, fitTo]);

  // "A-101 · Area 2 · 212 SF", ordered by sheet (rail order) then createdAt;
  // n counts that condition's measurements on that sheet. This sheet / All sheets applies.
  const sheetOrder = useMemo(() => new Map(railSheets(projectSheets, '').map((s, i) => [s.id, i])), [projectSheets]);
  const subRowsFor = useCallback((conditionId: string): MeasurementSubRow[] => {
    const ms = doc.measurements
      .filter((m) => m.conditionId === conditionId && (filter === 'all' || (active && m.sheetId === active.id)))
      .slice()
      .sort((a, b) => {
        const sa = sheetOrder.get(a.sheetId) ?? Number.MAX_SAFE_INTEGER;
        const sb = sheetOrder.get(b.sheetId) ?? Number.MAX_SAFE_INTEGER;
        if (sa !== sb) return sa - sb;
        if (a.sheetId !== b.sheetId) return a.sheetId < b.sheetId ? -1 : 1;
        return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
      });
    const nth = new Map<string, number>();
    return ms.map((m) => {
      const n = (nth.get(m.sheetId) ?? 0) + 1;
      nth.set(m.sheetId, n);
      const what = m.kind === 'area' ? 'Area' : m.kind === 'linear' ? 'Line' : 'Count';
      const q = measurementQuantity(m, m.kind === 'count' ? null : calFor(m.sheetId));
      const qty = q == null ? 'not measured — no scale' : qtyLabel(m.kind, q);
      return { id: m.id, text: `${sheetLabel(m.sheetId)} · ${what} ${n} · ${qty}` };
    });
  }, [doc.measurements, filter, active, sheetOrder, calFor, sheetLabel]);

  const activateRow = useCallback((id: string) => {
    setActiveCondId(id);
    const c = doc.conditions.find((x) => x.id === id);
    if (c && DRAW_KINDS.includes(tool) && tool !== c.kind) { setTool(c.kind); setDraftPts([]); }
    const pts = sheetMeasurements.filter((m) => m.conditionId === id).flatMap((m) => m.points);
    if (pts.length) fitTo(pts);
  }, [doc.conditions, tool, sheetMeasurements, fitTo]);

  // ── the condition editor ───────────────────────────────────────────────
  const editing = editor?.id ? doc.conditions.find((c) => c.id === editor.id) ?? null : null;
  const saveCondition = useCallback((edited: TakeoffCondition) => {
    const prev = doc.conditions.find((x) => x.id === edited.id);
    const isNew = !prev;
    // The editor builds the condition from its fields; an accepted AI read rides
    // along unless the kind changed (its unit would no longer match).
    const c: TakeoffCondition = prev?.aiRead && !edited.aiRead && prev.kind === edited.kind ? { ...edited, aiRead: prev.aiRead } : edited;
    update((d) => ({
      ...d,
      conditions: isNew ? [...d.conditions, c] : d.conditions.map((x) => (x.id === c.id ? c : x)),
    }));
    setActiveCondId(c.id);
    if (isNew && !toolsOffReason) setTool(c.kind);
    setEditor(null);
  }, [doc.conditions, update, toolsOffReason]);
  const deleteCondition = useCallback((id: string) => {
    update((d) => ({
      ...d,
      conditions: d.conditions.filter((c) => c.id !== id),
      measurements: d.measurements.filter((m) => m.conditionId !== id),
    }));
    if (activeCondId === id) { setActiveCondId(null); setTool('select'); }
    setSelectedId(null);
    setEditor(null);
  }, [update, activeCondId]);
  // Accept → a condition whose quantity of record is the AI number (undoable);
  // "Accept & measure" also picks its tool so he traces it — the first drawn
  // measurement replaces the AI number. Dismiss → remembered on the doc (undoable).
  const acceptSuggestion = useCallback((s: AiSuggestion, measure: boolean) => {
    // Nothing before the saved doc is read (update drops it), and a repeat of the same key is a no-op.
    if (!loaded || doc.conditions.some((x) => x.aiRead?.key === s.key)) return;
    const c = conditionFromSuggestion(s, db, doc.conditions.map((x) => x.color), generateUUID(), new Date().toISOString());
    update((d) => (d.conditions.some((x) => x.aiRead?.key === s.key) ? d : { ...d, conditions: [...d.conditions, c] }));
    setActiveCondId(c.id);
    if (measure && !toolsOffReason) { setTool(c.kind); setDraftPts([]); }
  }, [loaded, db, doc.conditions, update, toolsOffReason]);
  const dismissSuggestion = useCallback((s: AiSuggestion) => {
    update((d) => ({ ...d, aiDismissed: [...(d.aiDismissed ?? []).filter((k) => k !== s.key), s.key] }));
  }, [update]);
  const runAiTakeoff = useCallback(() => {
    if (projectId) router.push({ pathname: '/takeoff', params: { projectId } });
    else router.push('/takeoff');
  }, [projectId, router]);

  // ── starter chips (an empty takeoff), by the job's type label ─────────
  const starterDefs = useMemo(() => starterConditionsFor(projectTypeLabel(project)), [project]);
  // Not before the saved doc is read: a tap then would be dropped (edits before `loaded` are ignored).
  const starters = useMemo<StarterChip[]>(() => (!loaded || doc.conditions.length > 0 ? [] : starterDefs.map((s) => {
    const { entry } = resolveStarterTrade(db, s.tradeHint, s.kind);
    return { key: s.key, name: s.name, unit: KIND_UNIT[s.kind], rateLine: starterRateLine(entry, s.kind) };
  })), [loaded, doc.conditions.length, starterDefs, db]);
  // One click = the condition, saved through the editor's own path (it activates and picks the tool).
  const addStarter = useCallback((key: string) => {
    const s = starterDefs.find((x) => x.key === key);
    if (!s) return;
    const { trade } = resolveStarterTrade(db, s.tradeHint, s.kind);
    saveCondition({
      id: generateUUID(),
      name: s.name,
      kind: s.kind,
      trade,
      rateOverride: null,
      wastePct: 0,
      heightFt: null,
      color: defaultConditionColor(s.name, trade, doc.conditions.map((c) => c.color)),
      createdAt: new Date().toISOString(),
    });
  }, [starterDefs, db, saveCondition, doc.conditions]);

  const newCondition = useCallback(() => {
    setEditor({ id: null, kind: activeCond?.kind ?? (DRAW_KINDS.includes(tool) ? tool as ConditionKind : 'area') });
  }, [activeCond, tool]);

  // ── the scale ──────────────────────────────────────────────────────────
  const saveScale = useCallback((ft: number) => {
    if (!scaleDraft || !active) return;
    upsertPlanCalibration({
      planSheetId: active.id,
      projectId: active.projectId,
      p1: stampImageFrame(scaleDraft.p1),
      p2: stampImageFrame(scaleDraft.p2),
      realDistanceFt: ft,
    });
    setScaleDraft(null);
    setTool('select');
  }, [scaleDraft, active, upsertPlanCalibration]);

  // ── the push ───────────────────────────────────────────────────────────
  const { lines, skipped } = useMemo(() => pushLinesFrom(rollupAll.rows), [rollupAll]);
  const pushReason = pushBlockReason(project, lines);
  const est = project?.linkedEstimate ?? null;
  const preview = useMemo(
    () => (est && lines.length ? applyTakeoffPush(est, lines, doc.pushed, () => 'preview') : null),
    [est, lines, doc.pushed],
  );
  const push = useCallback(() => {
    if (pushReason || !project || !project.linkedEstimate) return;
    const r = applyTakeoffPush(project.linkedEstimate, lines, doc.pushed, generateUUID);
    updateProject(project.id, commitEstimatePatch(project, r.next, { reason: 'manual', note: 'Pushed from desktop takeoff' }));
    const at = new Date().toISOString();
    record((d) => ({
      ...d,
      pushed: { ...d.pushed, ...r.pushed },
      lastPush: { at, projectId: project.id, before: r.beforeGrand, after: r.afterGrand, added: r.added, updated: r.updated },
    }));
  }, [pushReason, project, lines, doc.pushed, updateProject, record]);
  usePrimaryAction(push, { label: 'Push to Estimate', disabled: !!pushReason, reason: pushReason, enabled: !!project });
  const openEstimate = useCallback(() => {
    if (project) router.push({ pathname: '/(tabs)/estimate/full', params: { projectId: project.id } });
  }, [project, router]);

  const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
  const costLine = [
    `Cost ${money(rollupAll.costCents / 100)}`,
    `${rollupAll.fromYourJobsCount} of ${rollupAll.rows.length} ${plural(rollupAll.rows.length, 'line', 'lines')} priced from your jobs`,
    rollupAll.unpricedCount > 0 ? `${rollupAll.unpricedCount} ${plural(rollupAll.unpricedCount, 'has', 'have')} no rate yet` : null,
  ].filter(Boolean).join(' · ');
  let markupLine: string | null = null;
  if (est && est.baseTotal > 0 && est.markupTotal > 0) {
    const pct = Math.round((est.markupTotal / est.baseTotal) * 1000) / 10;
    const add = preview ? preview.afterGrand - preview.beforeGrand : 0;
    markupLine = `Markup ${pct}% · Sell ${add < 0 ? '−' : '+'}${money(Math.abs(add))} with this push`;
  } else if (est) {
    markupLine = 'This total is your cost — the estimate has no markup yet';
  }
  const skippedLines = useMemo(() => {
    const n = (r: string) => skipped.filter((s) => s.reason === r).length;
    const out: string[] = [];
    const noRate = n('no_rate');
    const notMeasured = n('not_measured');
    const noQty = n('no_quantity');
    if (noRate) out.push(`${noRate} ${plural(noRate, 'has', 'have')} no rate yet — not pushed`);
    if (notMeasured) out.push(`${notMeasured} not measured (no scale on the sheet) — not pushed`);
    if (noQty) out.push(`${noQty} ${plural(noQty, 'has', 'have')} nothing measured — not pushed`);
    // The AI label rides into the estimate: say so before he pushes.
    const aiLines = lines.filter((l) => l.aiRead).length;
    if (aiLines) out.push(`${aiLines} ${plural(aiLines, 'line is an', 'lines are')} AI read, not measured — pushed as “… — AI read, not measured”`);
    return out;
  }, [skipped, lines]);
  const lp = doc.lastPush && project && doc.lastPush.projectId === project.id ? doc.lastPush : null;
  const result = lp
    ? { line: `Estimate updated ${money(lp.before)} → ${money(lp.after)}`, counts: lp.updated + lp.added === 0 ? 'Already up to date — nothing changed' : `${lp.updated} updated, ${lp.added} added` }
    : null;
  const pushLabel = `Push ${lines.length} ${plural(lines.length, 'line', 'lines')} to estimate`;

  // ── the status line ────────────────────────────────────────────────────
  let statusLine = '';
  if (tool === 'scale') {
    statusLine = draftPts.length === 0 ? 'Scale: click one end of a known dimension' : 'Scale: click the other end';
  } else if ((tool === 'area' || tool === 'linear' || tool === 'count') && (!activeCond || activeCond.kind !== tool)) {
    // Undo or a job switch can leave a draw tool with no matching condition:
    // clicks do nothing, so say why instead of falling through to Select copy.
    const which = tool === 'area' ? 'an Area condition (A)' : tool === 'linear' ? 'a Linear condition (L)' : 'a Count condition (C)';
    statusLine = `Pick or create ${which} to measure`;
  } else if ((tool === 'area' || tool === 'linear') && activeCond && active) {
    const q = draftPts.length >= (tool === 'area' ? 3 : 2)
      ? measurementQuantity({ id: '', conditionId: activeCond.id, sheetId: active.id, kind: tool, points: draftPts, createdAt: '', aspect: aspect ?? 1 }, activeCal)
      : null;
    statusLine = draftPts.length === 0
      ? `${activeCond.name} · click to add points`
      : `${activeCond.name} · ${q == null && activeCal ? '—' : qtyLabel(tool, q)} · ${draftPts.length} pts · Enter to finish · Backspace removes last point`;
  } else if (tool === 'count' && activeCond) {
    statusLine = `${activeCond.name} · click each one · ${sheetMeasurements.filter((m) => m.conditionId === activeCond.id).length} on this sheet`;
  } else if (tool === 'pan') {
    statusLine = 'Drag to pan · ⌘-scroll to zoom';
  } else {
    statusLine = selectedId ? 'Selected · Backspace deletes it · Esc clears' : 'Click a shape to select it · A, L or C to measure';
  }

  // ── keys (page scope; dead while a dialog is open, back when it closes) ─
  const live = useRef({ draftPts, selectedId, tool, shownRows, panelOpen });
  live.current = { draftPts, selectedId, tool, shownRows, panelOpen };
  // '/' focuses the filter (opening the panel first if it is hidden).
  const focusFilter = useCallback(() => {
    if (filterRef.current) { filterRef.current.focus(); return; }
    if (!live.current.panelOpen) togglePanel();
    setTimeout(() => filterRef.current?.focus(), 0);
  }, [togglePanel]);
  // 1–9: the Nth VISIBLE row (after This sheet / All sheets and the filter text). No row N → nothing.
  const pickNth = useCallback((n: number) => {
    const row = live.current.shownRows[n - 1];
    if (row) activateRow(row.condition.id);
  }, [activateRow]);
  const digitKeys = useMemo<HotkeyBinding[]>(() => [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
    n === 1
      ? { combo: String(n), handler: () => pickNth(n), label: 'Pick condition 1–9', group: 'Takeoff' }
      : { combo: String(n), handler: () => pickNth(n) }
  )), [pickNth]);
  const flip = useCallback((dir: 1 | -1) => {
    const id = active ? adjacentSheetId(rail, active.id, dir) : null;
    if (id) openSheet(id);
  }, [active, rail, openSheet]);
  useHotkeys([
    { combo: 'v', handler: () => chooseTool('select'), label: 'Select', group: 'Takeoff' },
    { combo: 'h', handler: () => chooseTool('pan'), label: 'Pan', group: 'Takeoff' },
    { combo: 'a', handler: () => chooseTool('area'), label: 'Area', group: 'Takeoff' },
    { combo: 'l', handler: () => chooseTool('linear'), label: 'Linear', group: 'Takeoff' },
    { combo: 'c', handler: () => chooseTool('count'), label: 'Count', group: 'Takeoff' },
    { combo: 'k', handler: () => chooseTool('scale'), label: 'Set the Scale', group: 'Takeoff' },
    { combo: 'enter', handler: finish, when: () => live.current.draftPts.length > 0, label: 'Finish the Shape', group: 'Takeoff' },
    {
      combo: 'escape',
      handler: () => {
        const c = live.current;
        if (c.draftPts.length) setDraftPts([]);
        else if (c.selectedId) setSelectedId(null);
        else setTool('select');
      },
      when: () => { const c = live.current; return c.draftPts.length > 0 || !!c.selectedId || c.tool !== 'select'; },
      label: 'Cancel the Shape / Back to Select',
      group: 'Takeoff',
    },
    {
      combo: 'backspace',
      handler: () => { if (live.current.draftPts.length) setDraftPts((p) => p.slice(0, -1)); else deleteSelected(); },
      when: () => live.current.draftPts.length > 0 || !!live.current.selectedId,
      label: 'Remove the Last Point / Delete the Shape',
      group: 'Takeoff',
    },
    { combo: 'mod+z', handler: undo, label: 'Undo', group: 'Takeoff' },
    { combo: 'mod+shift+z', handler: redo, label: 'Redo', group: 'Takeoff' },
    { combo: 'n', handler: newCondition, label: 'New Condition', group: 'Takeoff' },
    { combo: '/', handler: focusFilter, label: 'Filter Conditions', group: 'Takeoff' },
    // Esc typed IN the filter box clears it and hands the keys back (it outranks the Esc above).
    {
      combo: 'escape',
      handler: () => { setFilterText(''); filterRef.current?.blur(); },
      when: (ev) => targetWithin(ev.target, TAKEOFF_FILTER_DOM_ID),
      priority: 2,
    },
    ...digitKeys,
    { combo: 'plus', handler: () => zoomBy(1.25), label: 'Zoom In', group: 'Takeoff' },
    { combo: '=', handler: () => zoomBy(1.25) },
    { combo: '-', handler: () => zoomBy(0.8), label: 'Zoom Out', group: 'Takeoff' },
    { combo: '0', handler: fit, label: 'Fit', group: 'Takeoff' },
    { combo: 'shift+g', handler: () => setGrayscale((g) => !g), label: 'Grayscale Plan On/Off', group: 'Takeoff' },
    { combo: '[', handler: toggleRail, label: 'Sheet List', group: 'Takeoff' },
    { combo: ']', handler: togglePanel, label: 'Conditions Panel', group: 'Takeoff' },
    { combo: 'arrowup', handler: () => flip(-1), label: 'Previous Sheet', group: 'Takeoff' },
    { combo: 'arrowdown', handler: () => flip(1), label: 'Next Sheet', group: 'Takeoff' },
  ], { scope: 'page', enabled: !!active });

  // ── render ─────────────────────────────────────────────────────────────
  const scale = active ? planScaleStatus(getCalibrationForPlan(active.id)) : null;
  const draftColor = activeCond?.color ?? t.textSecondary;

  return (
    <View style={styles.root} testID="takeoffws-root">
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.top}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Back">
          <ChevronLeft size={20} color={t.text} strokeWidth={1.75} />
        </TouchableOpacity>
        {active && !railOpen ? (
          <TouchableOpacity onPress={toggleRail} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Show Sheet List ([)" testID="takeoffws-rail-open">
            <PanelLeftOpen size={16} color={t.textSecondary} strokeWidth={1.75} />
          </TouchableOpacity>
        ) : null}
        <Text style={styles.crumb} numberOfLines={1}>
          {project?.name ?? 'Takeoff'}
          <Text style={styles.crumbMuted}>{'  ›  Takeoff'}</Text>
          {active ? <Text style={styles.crumbMuted}>{`  ·  ${active.sheetNumber ? `${active.sheetNumber} ` : ''}${active.name}`}</Text> : null}
        </Text>
        {scale ? (
          <View style={styles.pill} accessibilityHint={scale === 'recheck' ? PLAN_SCALE_RECHECK_COPY : undefined} testID="takeoffws-scale-pill">
            {scale === 'ready' ? <View style={[styles.dot, { backgroundColor: t.success }]} /> : null}
            <Text style={[styles.pillText, scale !== 'ready' && { color: t.warningLabel }]}>
              {scale === 'ready' ? 'Scale Set' : scale === 'none' ? 'Set Scale (K)' : 'Re-Check Scale'}
            </Text>
          </View>
        ) : null}
        <View style={styles.spacer} />
        {project ? (
          <>
            {pushReason ? <Text style={styles.topReason} numberOfLines={1}>{pushReason}</Text> : null}
            <TouchableOpacity
              onPress={push}
              disabled={!!pushReason}
              style={[styles.topPush, !!pushReason && styles.off]}
              accessibilityRole="button"
              accessibilityState={{ disabled: !!pushReason }}
              accessibilityHint={pushReason ?? undefined}
              testID="takeoffws-top-push"
            >
              <Text style={styles.topPushText}>{`Push ${lines.length} ${plural(lines.length, 'line', 'lines')}`}</Text>
            </TouchableOpacity>
          </>
        ) : null}
        {active && !panelOpen ? (
          <TouchableOpacity onPress={togglePanel} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Show Conditions (])" testID="takeoffws-panel-open">
            <PanelRightOpen size={16} color={t.textSecondary} strokeWidth={1.75} />
          </TouchableOpacity>
        ) : null}
      </View>

      {/* seam:first-run */}
      {!projectId || !active ? (
        <TakeoffFirstRun projectId={projectId} jobs={estimateJobs} onPickJob={pickProject} dropState={drop} onDropFile={async (f) => { const ids = await drop.importFile(f); if (ids[0]) openSheet(ids[0]); return ids; }} />
      ) : (
        <View style={styles.body}>
          {/* seam:rail */}
          {railOpen ? (
            <RailDropZone drop={drop} onImported={(ids) => { if (ids[0]) openSheet(ids[0]); }} testID="takeoffws-rail-drop">
              <PlanSheetRail
                sheets={rail}
                activeId={active.id}
                onPick={openSheet}
                onClose={toggleRail}
                sheetUri={sheetUri}
                badgeFor={(s) => doc.measurements.filter((m) => m.sheetId === s.id).length}
                scaleFor={(s) => planScaleStatus(getCalibrationForPlan(s.id))}
              />
            </RailDropZone>
          ) : null}
          <TakeoffCanvas
            uri={uri}
            paper={paper}
            aspect={aspect}
            view={view}
            onView={setView}
            onCanvasSize={onCanvasSize}
            shapes={shapes}
            draft={draftPts.length ? { kind: tool === 'scale' ? 'scale' : (tool as ConditionKind), points: draftPts, color: tool === 'scale' ? t.text : draftColor } : null}
            selectedId={selectedId}
            emphasisConditionId={panelOpen && hoverCondId && colorOf.has(hoverCondId) ? hoverCondId : null}
            tool={tool}
            onTool={chooseTool}
            toolsOffReason={toolsOffReason}
            showScaleStrip={(tool === 'area' || tool === 'linear') && !activeCal && !toolsOffReason}
            grayscale={grayscale}
            statusLine={statusLine}
            onAddPoint={onAddPoint}
            onFinish={finish}
            onSelect={onSelect}
            onMoveVertex={onMoveVertex}
            onZoomIn={() => zoomBy(1.25)}
            onZoomOut={() => zoomBy(0.8)}
            onFit={fit}
          />
          {panelOpen ? (
            <ConditionsPanel
              rows={panelRows}
              filter={filter}
              onFilter={setFilter}
              activeId={activeCondId}
              onActivate={activateRow}
              onEdit={(id) => setEditor({ id, kind: doc.conditions.find((c) => c.id === id)?.kind ?? 'area' })}
              onNew={newCondition}
              sheetLabel={sheetLabel}
              costLine={costLine}
              markupLine={markupLine}
              jobs={estimateJobs}
              projectId={projectId}
              onPickJob={pickProject}
              pushLabel={pushLabel}
              pushReason={pushReason}
              onPush={push}
              result={result}
              onOpenEstimate={openEstimate}
              skippedLines={skippedLines}
              saveLine={saveLine}
              conflict={conflict}
              filterText={filterText}
              onFilterText={setFilterText}
              filterInputRef={filterRef}
              starters={starters}
              onStarter={addStarter}
              subRowsFor={subRowsFor}
              selectedMeasurementId={selectedId}
              onPickMeasurement={pickMeasurement}
              onDeleteMeasurement={deleteMeasurement}
              onHoverCondition={setHoverCondId}
              drawnAnywhere={drawnAnywhere}
              ai={{
                // Until the doc is read, what he already took is unknown: show loading, not rows.
                state: loaded ? aiSaved.state : 'loading',
                savedAt: aiSaved.savedAt,
                rows: aiSug.rows,
                skipped: aiSug.skipped,
                onAccept: (s) => acceptSuggestion(s, false),
                onAcceptMeasure: (s) => acceptSuggestion(s, true),
                onDismiss: dismissSuggestion,
                onRunAi: runAiTakeoff,
                onRetry: aiSaved.reload,
              }}
            />
          ) : null}
        </View>
      )}

      {editor ? (
        <ConditionEditor
          condition={editing}
          initialKind={editor.kind}
          hasMeasurements={!!editing && doc.measurements.some((m) => m.conditionId === editing.id)}
          isPushed={!!editing && !!doc.pushed[editing.id]}
          db={db}
          usedColors={doc.conditions.filter((c) => c.id !== editing?.id).map((c) => c.color)}
          onSave={saveCondition}
          onDelete={deleteCondition}
          onClose={() => setEditor(null)}
        />
      ) : null}
      {scaleDraft ? <ScaleDialog onSave={saveScale} onClose={() => { setScaleDraft(null); setTool('select'); }} /> : null}
    </View>
  );
}

/** "How long is that?" — mounted only while open (HOTKEYS rule). */
function ScaleDialog({ onSave, onClose }: { onSave: (ft: number) => void; onClose: () => void }) {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [text, setText] = useState('');
  const ft = parseDecimalInput(text);
  const reason = ft != null && ft > 0 ? null : 'Type the real length in feet (e.g. 12 or 12.5).';
  const save = useCallback(() => { if (ft != null && ft > 0) onSave(ft); }, [ft, onSave]);
  useHotkeys([
    { combo: 'escape', handler: onClose, label: 'Close', group: 'Scale' },
    { combo: 'enter', handler: save, allowInInput: true, label: 'Save the Scale', group: 'Scale' },
  ], { scope: 'dialog' });
  return (
    <Sheet
      visible
      onClose={onClose}
      size="dialog"
      title="Set the Scale"
      subtitle="How long is the line you just clicked, in real feet?"
      primaryAction={{ label: 'Save Scale', onPress: save, disabled: !!reason, disabledReason: text.trim() ? reason ?? undefined : undefined, testID: 'takeoffws-scale-save' }}
      secondaryAction={{ label: 'Cancel', onPress: onClose }}
      testID="takeoffws-scale-dialog"
    >
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder="Feet, e.g. 24"
        placeholderTextColor={t.textMuted}
        keyboardType="decimal-pad"
        style={styles.input}
        accessibilityLabel="Real Length in Feet"
        testID="takeoffws-scale-feet"
      />
      <Text style={styles.hint}>Saved to this sheet — Plan Viewer and the phone use the same scale.</Text>
    </Sheet>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: t.bg },
  top: {
    height: Layout.control.toolbar,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Layout.rowGap,
    paddingHorizontal: Layout.rowGap,
    backgroundColor: t.surface,
    borderBottomWidth: 1,
    borderBottomColor: t.line,
  },
  iconBtn: { width: Layout.control.sm, height: Layout.control.sm, alignItems: 'center', justifyContent: 'center', borderRadius: Tokens.radius.sm },
  crumb: { ...Type.footnoteEmphasized, color: t.text, flexShrink: 1 },
  crumbMuted: { color: t.textSecondary, fontWeight: '400' },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 24,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: t.line,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  pillText: { ...Type.caption1, color: t.textSecondary, fontWeight: '600' },
  spacer: { flex: 1 },
  topReason: { ...Type.caption1, color: t.textMuted, maxWidth: 360 },
  topPush: {
    height: Layout.control.sm,
    paddingHorizontal: Layout.cardPad,
    borderRadius: Tokens.radius.sm,
    backgroundColor: t.accentFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topPushText: { ...Type.footnoteEmphasized, color: '#FFFFFF' },
  off: { opacity: 0.45 },
  body: { flex: 1, flexDirection: 'row', minHeight: 0 },
  input: {
    minHeight: Layout.control.input,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: t.line,
    borderRadius: Tokens.radius.sm,
    backgroundColor: t.bg,
    color: t.text,
    fontSize: Type.bodyCompact.fontSize,
  },
  hint: { ...Type.caption1, color: t.textMuted, marginTop: Layout.rowGap },
});
