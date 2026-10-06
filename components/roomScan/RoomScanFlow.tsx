// components/roomScan/RoomScanFlow.tsx — Scan The Room, one screen, four steps:
// the start (can this phone scan, and what to do before), The Floor Plan, The
// Quantities, The Priced Estimate. Each step after the start is a section with
// a back chevron, the app's modal-in-screen pattern.
//
// This file owns the state and the side effects. The maths is in
// utils/roomScan (pure) and the three views draw what they are handed.
//
// WHAT THIS FILE WRITES, AND WHEN
//   the phone's storage   only on the Save Scan tap, after a confirmed draft,
//                         and on the yes of the Delete Scan sheet;
//   the estimate          only from the confirm sheet's yes (buildEstimatePatch
//                         refuses without `confirmed: true` and without
//                         `mayEdit: true`, his seat on the project), through
//                         updateProject, which is the project's own
//                         offline-safe write. A project with no estimate gets
//                         one started by the same yes (pricingCore).
// "Added to the estimate." is said only after the project the app holds is
// seen to carry the lines (pricingCore.estimateHoldsPush); until then the
// button shows it is working, and if the lines never show the screen says so.
// Nothing is sent to a client, and no row is written to the server for the
// scan itself (see utils/roomScan/storeCore.ts).
//
// A SCAN IS NEVER NAMED FOR HIM. It starts with an empty name; the name goes
// on every estimate line, so Save and Price both ask for one.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { ChevronLeft, Ruler, Trash2 } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useT } from '@/contexts/LanguageContext';
import { useProjects } from '@/contexts/ProjectContext';
import { useMaterialCart } from '@/contexts/MaterialCartContext';
import { useScopeCostBook } from '@/hooks/useScopeCostBook';
import { Button, Sheet } from '@/components/ui';
import { useRoomScanCopy } from '@/hooks/useRoomScanCopy';
import { formatCalendarDay, calendarDayOf } from '@/utils/calendarDate';
import { formatTimeL } from '@/i18n/format';
import { generateUUID } from '@/utils/generateId';
import type { MarkupPct } from '@/utils/estimateMarkup';
import { roomScanAvailability, type RoomScanAvailability } from '@/utils/roomScan/availability';
import { parseCapturedRoom } from '@/utils/roomScan/capturedRoomParser';
import { makeCatalogRater } from '@/utils/roomScan/catalogRate';
import { correctCeilingHeight, correctOpening, correctWallLength, renameScan } from '@/utils/roomScan/editsCore';
import { buildRoomScan } from '@/utils/roomScan/geometryCore';
import * as RoomScanNative from '@/utils/roomScan/native';
import { buildEstimatePatch, buildScanDraft, draftBlock, draftPushLines, estimateHoldsPush, startsEstimate } from '@/utils/roomScan/pricingCore';
import { computeQuantities, scanFacts, scanPricingBlock } from '@/utils/roomScan/quantitiesCore';
import { ROOM_RECIPES, type RecipeKey } from '@/utils/roomScan/recipesCore';
import { deleteScan, hashRawScan, loadSavedScans, saveScan } from '@/utils/roomScan/store';
import type { SavedScan } from '@/utils/roomScan/storeCore';
import type { RoomScan, RoomType } from '@/utils/roomScan/types';
import { EditMeasureSheet, type EditTarget } from './EditMeasureSheet';
import { FloorPlanView } from './FloorPlanView';
import { PricedDraftView } from './PricedDraftView';
import { QuantitiesView } from './QuantitiesView';
import { makeRoomScanStyles } from './styles';

type Step = 'start' | 'plan' | 'quantities' | 'price';
type Editing =
  | { on: 'wall'; id: string }
  | { on: 'ceiling' }
  | { on: 'opening'; id: string; field: 'widthM' | 'heightM' };

export interface RoomScanFlowProps {
  projectId: string;
  /**
   * May this person change this project's estimate? The route passes true only
   * for the owner or an editor (utils/roomScan/gate.scanSeat). Anything else
   * can look at a scan and its quantities but cannot push: the button is
   * blocked and says why, and the pure core refuses the patch.
   */
  mayEditEstimate: boolean;
  /** A scan to open straight on the plan (a saved one, or a fixture in a test). */
  initial?: SavedScan;
}

const emptySaved = (scan: RoomScan): SavedScan => ({ scan, pushed: {}, manualRates: {}, excluded: [], savedAt: '', pricedAt: null });

/** How long a confirmed push waits to see its lines on the project, in steps of KEPT_STEP_MS. */
const KEPT_TRIES = 15;
const KEPT_STEP_MS = 100;
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function RoomScanFlow({ projectId, mayEditEstimate, initial }: RoomScanFlowProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeRoomScanStyles);
  const copy = useRoomScanCopy();
  const { lang } = useT();
  const { getProject, updateProject, settings } = useProjects();
  const project = getProject(projectId) ?? null;
  // The newest getProject, for reading the project back after a write (a
  // callback keeps the one from the render it was made in).
  const getProjectRef = useRef(getProject);
  getProjectRef.current = getProject;
  const db = useScopeCostBook();
  // His stated markup: the one the estimator, the wizard and Quick Quote
  // share. null until he has answered, so an unanswered markup is never
  // written (the rule app/takeoff-estimate.tsx and the Drawing Analyzer follow).
  const { globalMarkup: savedMarkup, markupDecided } = useMaterialCart();
  const markupPct: MarkupPct = markupDecided === true ? savedMarkup : null;
  const location = typeof settings?.location === 'string' ? settings.location : '';
  const catalog = useMemo(() => makeCatalogRater(location), [location]);

  const [step, setStep] = useState<Step>(initial ? 'plan' : 'start');
  const [saved, setSaved] = useState<SavedScan | null>(initial ?? null);
  const [rawJson, setRawJson] = useState<string | null>(null);
  const [avail, setAvail] = useState<RoomScanAvailability>(() => roomScanAvailability(RoomScanNative.getCapabilities()));
  const [busy, setBusy] = useState(false);
  const [scanError, setScanError] = useState<'failed' | 'unreadable' | null>(null);
  const [savedList, setSavedList] = useState<SavedScan[]>([]);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saved' | 'failed' | 'needsName'>('idle');
  const [result, setResult] = useState<'idle' | 'added' | 'failed' | 'unconfirmed'>('idle');
  const [pushing, setPushing] = useState(false);
  /** True when the scan on screen has something the phone does not hold: a new scan, or a change since the last save. */
  const [dirty, setDirty] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [deleting, setDeleting] = useState<SavedScan | null>(null);
  const [deleteFailed, setDeleteFailed] = useState(false);

  const refreshSavedList = useCallback(async () => {
    const l = await loadSavedScans(projectId);
    setSavedList(l.scans);
  }, [projectId]);

  useEffect(() => {
    let live = true;
    void loadSavedScans(projectId).then((l) => { if (live) setSavedList(l.scans); });
    return () => { live = false; };
  }, [projectId]);

  const scan = saved?.scan ?? null;
  const quantities = useMemo(() => (scan ? computeQuantities(scan) : null), [scan]);
  const facts = useMemo(() => (scan && quantities ? scanFacts(scan, quantities) : []), [scan, quantities]);
  const draft = useMemo(() => {
    if (!saved || !quantities) return null;
    // The estimate line carries the room's name, in the person's language.
    const names: Partial<Record<RecipeKey, string>> = {};
    for (const r of ROOM_RECIPES[saved.scan.roomType]) names[r.key] = `${copy.lineName(r.key)}, ${saved.scan.name}`;
    return buildScanDraft(saved.scan, quantities, db, catalog, { manualRates: saved.manualRates, excluded: saved.excluded, names });
  }, [saved, quantities, db, catalog, copy]);

  const change = useCallback((fn: (s: RoomScan) => RoomScan) => {
    setSaved((cur) => (cur ? { ...cur, scan: fn(cur.scan) } : cur));
    setSaveState('idle');
    setResult('idle');
    setDirty(true);
  }, []);

  // ── the scan ──
  const refreshAvailability = useCallback(() => setAvail(roomScanAvailability(RoomScanNative.getCapabilities())), []);
  const allowCamera = useCallback(async () => {
    try { await ImagePicker.requestCameraPermissionsAsync(); } catch { /* the sentence on screen already says what is needed */ }
    refreshAvailability();
  }, [refreshAvailability]);

  const startScan = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setScanError(null);
    const scanId = generateUUID();
    try {
      const raw = await RoomScanNative.startScan({ scanId, exportUsdz: false });
      if (raw.status !== 'done' || !raw.capturedRoomJson) return; // cancelled: nothing happened, nothing to say
      let next: RoomScan;
      try {
        const parsed = parseCapturedRoom(raw.capturedRoomJson);
        next = buildRoomScan(parsed, {
          id: scanId,
          projectId,
          // No name yet. The field shows an example as its placeholder; the
          // scan itself is never called "Hall Bathroom" for him.
          name: '',
          capturedAt: raw.endedAt || new Date().toISOString(),
          device: { model: raw.deviceModel ?? '', os: raw.roomPlanSdk ?? '' },
          warnings: raw.warnings ?? [],
          rawSha256: await hashRawScan(raw.capturedRoomJson),
        });
      } catch {
        setScanError('unreadable');
        return;
      }
      setRawJson(raw.capturedRoomJson);
      setSaved(emptySaved(next));
      setSaveState('idle');
      setResult('idle');
      setDirty(true);
      setStep('plan');
    } catch {
      setScanError('failed');
      refreshAvailability();
    } finally {
      setBusy(false);
    }
  }, [busy, projectId, refreshAvailability]);

  // ── fixing a number ──
  const editTarget: EditTarget | null = useMemo(() => {
    if (!editing || !scan) return null;
    if (editing.on === 'wall') {
      const w = scan.walls.find((x) => x.id === editing.id);
      return w ? { kind: 'wall', what: copy.wallName(w.label), currentM: w.lengthM } : null;
    }
    if (editing.on === 'ceiling') return { kind: 'ceiling', what: copy.ceilingLabel, currentM: scan.ceilingHeightM.known ? scan.ceilingHeightM.typical : 0 };
    const o = scan.openings.find((x) => x.id === editing.id);
    if (!o) return null;
    const what = o.kind === 'door' ? copy.doorLabel : o.kind === 'window' ? copy.windowLabel : copy.openingLabel;
    return editing.field === 'widthM' ? { kind: 'width', what, currentM: o.widthM } : { kind: 'height', what, currentM: o.heightM };
  }, [editing, scan, copy]);

  const applyEdit = useCallback((metres: number) => {
    const e = editing;
    setEditing(null);
    if (!e) return;
    const at = new Date().toISOString();
    if (e.on === 'wall') change((s) => correctWallLength(s, e.id, metres, at));
    else if (e.on === 'ceiling') change((s) => correctCeilingHeight(s, metres, at));
    else change((s) => correctOpening(s, e.id, e.field, metres, at));
  }, [editing, change]);

  // ── saving, only from a tap ──
  const save = useCallback(async () => {
    if (!saved) return;
    if (!saved.scan.name.trim()) { setSaveState('needsName'); return; }
    const next: SavedScan = { ...saved, savedAt: new Date().toISOString() };
    const ok = await saveScan(next, rawJson);
    setSaveState(ok ? 'saved' : 'failed');
    if (ok) { setSaved(next); setDirty(false); await refreshSavedList(); }
  }, [saved, rawJson, refreshSavedList]);

  const confirmDraft = useCallback(async () => {
    if (!saved || !draft || pushing) return;
    const res = buildEstimatePatch({
      confirmed: true, mayEdit: mayEditEstimate, project, draft, pushed: saved.pushed,
      newId: generateUUID, markupPct, now: new Date().toISOString(),
    });
    if (!res || !project) { setResult('failed'); return; }
    setPushing(true);
    try {
      updateProject(project.id, res.patch);
      // Read the project back from the app's own state until it carries the
      // lines. Only then is anything said, recorded or opened.
      let kept = false;
      for (let i = 0; i < KEPT_TRIES && !kept; i++) {
        kept = estimateHoldsPush(getProjectRef.current(project.id) ?? null, res);
        if (!kept) await pause(KEPT_STEP_MS);
      }
      if (!kept) { setResult('unconfirmed'); return; }
      const now = new Date().toISOString();
      const next: SavedScan = { ...saved, pushed: res.pushed, savedAt: now, pricedAt: now };
      setSaved(next);
      const stored = await saveScan(next, rawJson);
      if (stored) { setDirty(false); await refreshSavedList(); }
      setResult('added');
      router.push({ pathname: '/project-detail', params: { id: project.id, tile: 'linkedEstimate' } });
    } finally {
      setPushing(false);
    }
  }, [saved, draft, pushing, mayEditEstimate, project, markupPct, updateProject, rawJson, refreshSavedList, router]);

  // ── deleting a saved scan, only from its confirm sheet ──
  const confirmDelete = useCallback(async () => {
    const target = deleting;
    setDeleting(null);
    if (!target) return;
    const ok = await deleteScan(projectId, target.scan.id);
    setDeleteFailed(!ok);
    await refreshSavedList();
  }, [deleting, projectId, refreshSavedList]);

  const leavePlan = useCallback(() => {
    setLeaving(false);
    setDirty(false);
    if (initial) { router.back(); return; }
    setSaved(null);
    setRawJson(null);
    setStep('start');
  }, [initial, router]);

  const back = useCallback(() => {
    if (step === 'price') setStep('quantities');
    else if (step === 'quantities') setStep('plan');
    // Leaving the plan drops whatever the phone does not hold. Ask first.
    else if (step === 'plan' && dirty) setLeaving(true);
    else if (step === 'plan') leavePlan();
    else router.back();
  }, [step, dirty, leavePlan, router]);

  const title = step === 'plan' && scan ? (scan.name || copy.titleLabel)
    : step === 'quantities' ? copy.quantitiesTitleLabel
    : step === 'price' ? copy.draftTitleLabel
    : copy.titleLabel;
  const scannedSub = scan
    ? copy.scannedSub(formatCalendarDay(calendarDayOf(scan.capturedAt), undefined, lang), formatTimeL(scan.capturedAt, lang))
    : '';

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]} testID="scan-room-flow">
      <View style={styles.header}>
        <Pressable onPress={back} style={styles.backBtn} accessibilityRole="button" accessibilityLabel={copy.backLabel} testID="scan-back">
          <ChevronLeft size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 24 }} keyboardShouldPersistTaps="handled">
        {step === 'start' && (
          <View style={styles.body} testID="scan-start">
            <Text style={styles.para}>{copy.startBody}</Text>
            {avail.available ? (
              <>
                <View style={styles.card}>
                  <Text style={styles.cardHeading}>{copy.tipsHeadingLabel}</Text>
                  {copy.tips.map((tip) => (
                    <View key={tip} style={styles.factRow}>
                      <Ruler size={14} color={colors.textMuted} />
                      <Text style={styles.factText}>{tip}</Text>
                    </View>
                  ))}
                </View>
                {scanError && <Text style={styles.errorText}>{scanError === 'failed' ? copy.scanFailedBody : copy.scanUnreadableBody}</Text>}
                <Button label={copy.startScanLabel} variant="primary" onPress={() => void startScan()} loading={busy} testID="scan-start-button" />
              </>
            ) : (
              <View style={styles.blocked} testID={`scan-unavailable-${avail.reason}`}>
                <Text style={styles.blockedText}>{copy.unavailableBody(avail.reason ?? 'notInThisBuild')}</Text>
                {avail.action === 'none' && <Text style={styles.blockedText}>{copy.otherWaysBody}</Text>}
              </View>
            )}
            {avail.action === 'requestCamera' && <Button label={copy.allowCameraLabel} variant="primary" onPress={() => void allowCamera()} testID="scan-allow-camera" />}
            {avail.action === 'openSettings' && <Button label={copy.openSettingsLabel} variant="secondary" onPress={() => void Linking.openSettings()} testID="scan-open-settings" />}

            <View style={styles.card}>
              <Text style={styles.cardHeading}>{copy.savedHeadingLabel}</Text>
              {savedList.length === 0 && <Text style={styles.note}>{copy.savedEmptyBody}</Text>}
              {deleteFailed && <Text style={styles.errorText}>{copy.deleteFailedBody}</Text>}
              {savedList.map((s, i) => (
                <View key={s.scan.id} style={[styles.row, i === 0 && styles.rowFirst]} testID={`scan-saved-${s.scan.id}`}>
                  <Pressable style={styles.rowMain} accessibilityRole="button" testID={`scan-saved-open-${s.scan.id}`}
                    onPress={() => { setSaved(s); setRawJson(null); setSaveState('idle'); setResult('idle'); setDirty(false); setStep('plan'); }}>
                    <Text style={styles.rowLabel}>{s.scan.name}</Text>
                    <Text style={styles.rowSub}>{copy.savedRowSub(formatCalendarDay(calendarDayOf(s.scan.capturedAt), undefined, lang), s.scan.walls.length)}</Text>
                  </Pressable>
                  <Pressable style={styles.backBtn} accessibilityRole="button" accessibilityLabel={copy.deleteA11yLabel(s.scan.name)} hitSlop={8}
                    onPress={() => { setDeleteFailed(false); setDeleting(s); }} testID={`scan-saved-delete-${s.scan.id}`}>
                    <Trash2 size={18} color={colors.dangerLabel} />
                  </Pressable>
                </View>
              ))}
            </View>
          </View>
        )}
        {step === 'plan' && scan && quantities && (
          <FloorPlanView
            scan={scan}
            quantities={quantities}
            facts={facts}
            copy={copy}
            scannedSub={scannedSub}
            saveState={saveState}
            onEditWall={(id) => setEditing({ on: 'wall', id })}
            onEditCeiling={() => setEditing({ on: 'ceiling' })}
            onEditOpening={(id, field) => setEditing({ on: 'opening', id, field })}
            onRename={(name) => change((s) => renameScan(s, name))}
            onRoomType={(rt: RoomType) => change((s) => (s.roomType === rt ? s : { ...s, roomType: rt }))}
            onSave={() => void save()}
            onNext={() => setStep('quantities')}
          />
        )}
        {step === 'quantities' && scan && quantities && (
          <QuantitiesView quantities={quantities} copy={copy} block={scanPricingBlock(scan, quantities)} onPrice={() => setStep('price')} />
        )}
        {step === 'price' && saved && draft && (
          <PricedDraftView
            roomName={saved.scan.name}
            draft={draft}
            copy={copy}
            block={draftBlock(project, draft, { mayEdit: mayEditEstimate, markupPct })}
            pushCount={draftPushLines(draft).length}
            starting={startsEstimate(project)}
            markupPct={markupPct}
            result={result}
            busy={pushing}
            onManualRate={(key, rate) => {
              setSaved((cur) => {
                if (!cur) return cur;
                const manualRates = { ...cur.manualRates };
                if (rate == null) delete manualRates[key]; else manualRates[key] = rate;
                return { ...cur, manualRates };
              });
              setResult('idle');
              setDirty(true);
            }}
            onToggle={(key) => {
              setSaved((cur) => (cur ? { ...cur, excluded: cur.excluded.includes(key) ? cur.excluded.filter((k) => k !== key) : [...cur.excluded, key] } : cur));
              setResult('idle');
              setDirty(true);
            }}
            onConfirm={() => void confirmDraft()}
          />
        )}
      </ScrollView>
      <EditMeasureSheet target={editTarget} copy={copy} onCancel={() => setEditing(null)} onSave={applyEdit} />
      <Sheet
        visible={leaving}
        onClose={() => setLeaving(false)}
        size="form"
        title={copy.leaveTitleLabel}
        testID="scan-leave-sheet"
        secondaryAction={{ label: copy.leaveNoLabel, onPress: () => setLeaving(false), testID: 'scan-leave-stay' }}
        destructiveAction={{ label: copy.leaveYesLabel, onPress: leavePlan, testID: 'scan-leave-discard' }}
      >
        <Text style={styles.para}>{copy.leaveBody}</Text>
      </Sheet>
      <Sheet
        visible={deleting != null}
        onClose={() => setDeleting(null)}
        size="form"
        title={copy.deleteTitleLabel}
        testID="scan-delete-sheet"
        secondaryAction={{ label: copy.deleteNoLabel, onPress: () => setDeleting(null), testID: 'scan-delete-keep' }}
        destructiveAction={{ label: copy.deleteYesLabel, onPress: () => void confirmDelete(), testID: 'scan-delete-yes' }}
      >
        <Text style={styles.para}>{deleting ? copy.deleteBody(deleting.scan.name) : ''}</Text>
      </Sheet>
    </View>
  );
}
