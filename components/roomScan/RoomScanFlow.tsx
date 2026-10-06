// components/roomScan/RoomScanFlow.tsx — Scan The Room, one screen, four steps:
// the start (can this phone scan, and what to do before), The Floor Plan, The
// Quantities, The Priced Estimate. Each step after the start is a section with
// a back chevron, the app's modal-in-screen pattern.
//
// This file owns the state and the side effects. The maths is in
// utils/roomScan (pure) and the three views draw what they are handed.
//
// WHAT THIS FILE WRITES, AND WHEN
//   the phone's storage   only on the Save Scan tap, and after a confirmed draft;
//   the estimate          only from the confirm sheet's yes (buildEstimatePatch
//                         refuses without `confirmed: true`), through
//                         updateProject, which is the project's own offline-safe write.
// Nothing is sent to a client, and no row is written to the server for the
// scan itself (see utils/roomScan/storeCore.ts).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { ChevronLeft, Ruler } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useT } from '@/contexts/LanguageContext';
import { useProjects } from '@/contexts/ProjectContext';
import { useScopeCostBook } from '@/hooks/useScopeCostBook';
import { Button } from '@/components/ui';
import { useRoomScanCopy } from '@/hooks/useRoomScanCopy';
import { formatCalendarDay, calendarDayOf } from '@/utils/calendarDate';
import { formatTimeL } from '@/i18n/format';
import { generateUUID } from '@/utils/generateId';
import { roomScanAvailability, type RoomScanAvailability } from '@/utils/roomScan/availability';
import { parseCapturedRoom } from '@/utils/roomScan/capturedRoomParser';
import { makeCatalogRater } from '@/utils/roomScan/catalogRate';
import { correctCeilingHeight, correctOpening, correctWallLength, renameScan } from '@/utils/roomScan/editsCore';
import { buildRoomScan } from '@/utils/roomScan/geometryCore';
import * as RoomScanNative from '@/utils/roomScan/native';
import { buildEstimatePatch, buildScanDraft, draftBlock, draftPushLines } from '@/utils/roomScan/pricingCore';
import { computeQuantities, pricingBlock, scanFacts } from '@/utils/roomScan/quantitiesCore';
import type { RecipeKey } from '@/utils/roomScan/recipesCore';
import { hashRawScan, loadSavedScans, saveScan } from '@/utils/roomScan/store';
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
  /** A scan to open straight on the plan (a saved one, or a fixture in a test). */
  initial?: SavedScan;
}

const emptySaved = (scan: RoomScan): SavedScan => ({ scan, pushed: {}, manualRates: {}, excluded: [], savedAt: '', pricedAt: null });

export function RoomScanFlow({ projectId, initial }: RoomScanFlowProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeRoomScanStyles);
  const copy = useRoomScanCopy();
  const { lang } = useT();
  const { getProject, updateProject, settings } = useProjects();
  const project = getProject(projectId) ?? null;
  const db = useScopeCostBook();
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
  const [saveState, setSaveState] = useState<'idle' | 'saved' | 'failed'>('idle');
  const [result, setResult] = useState<'idle' | 'added' | 'failed'>('idle');

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
    const names: Partial<Record<RecipeKey, string>> = {};
    const d = buildScanDraft(saved.scan, quantities, db, catalog, { manualRates: saved.manualRates, excluded: saved.excluded });
    for (const l of d.lines) names[l.key] = `${copy.lineName(l.key)}, ${saved.scan.name}`;
    // Priced twice so the estimate line carries the room's name in the person's language.
    return buildScanDraft(saved.scan, quantities, db, catalog, { manualRates: saved.manualRates, excluded: saved.excluded, names });
  }, [saved, quantities, db, catalog, copy]);

  const change = useCallback((fn: (s: RoomScan) => RoomScan) => {
    setSaved((cur) => (cur ? { ...cur, scan: fn(cur.scan) } : cur));
    setSaveState('idle');
    setResult('idle');
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
          name: copy.namePlaceholder,
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
      setStep('plan');
    } catch {
      setScanError('failed');
      refreshAvailability();
    } finally {
      setBusy(false);
    }
  }, [busy, projectId, copy.namePlaceholder, refreshAvailability]);

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
    const next: SavedScan = { ...saved, savedAt: new Date().toISOString() };
    const ok = await saveScan(next, rawJson);
    setSaveState(ok ? 'saved' : 'failed');
    if (ok) { setSaved(next); setSavedList((l) => [next, ...l.filter((x) => x.scan.id !== next.scan.id)]); }
  }, [saved, rawJson]);

  const confirmDraft = useCallback(async () => {
    if (!saved || !draft) return;
    const res = buildEstimatePatch({ confirmed: true, project, draft, pushed: saved.pushed, newId: generateUUID });
    if (!res || !project) { setResult('failed'); return; }
    updateProject(project.id, res.patch);
    const now = new Date().toISOString();
    const next: SavedScan = { ...saved, pushed: res.pushed, savedAt: now, pricedAt: now };
    setSaved(next);
    await saveScan(next, rawJson);
    setResult('added');
    router.push({ pathname: '/project-detail', params: { id: project.id, tile: 'linkedEstimate' } });
  }, [saved, draft, project, updateProject, rawJson, router]);

  const back = useCallback(() => {
    if (step === 'price') setStep('quantities');
    else if (step === 'quantities') setStep('plan');
    else if (step === 'plan' && !initial) setStep('start');
    else router.back();
  }, [step, initial, router]);

  const title = step === 'plan' && scan ? scan.name
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
              {savedList.map((s, i) => (
                <Pressable key={s.scan.id} style={[styles.row, i === 0 && styles.rowFirst]} accessibilityRole="button"
                  onPress={() => { setSaved(s); setRawJson(null); setSaveState('idle'); setResult('idle'); setStep('plan'); }}>
                  <View style={styles.rowMain}>
                    <Text style={styles.rowLabel}>{s.scan.name}</Text>
                    <Text style={styles.rowSub}>{copy.savedRowSub(formatCalendarDay(calendarDayOf(s.scan.capturedAt), undefined, lang), s.scan.walls.length)}</Text>
                  </View>
                </Pressable>
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
        {step === 'quantities' && quantities && (
          <QuantitiesView quantities={quantities} copy={copy} block={pricingBlock(quantities)} onPrice={() => setStep('price')} />
        )}
        {step === 'price' && saved && draft && (
          <PricedDraftView
            roomName={saved.scan.name}
            draft={draft}
            copy={copy}
            block={draftBlock(project, draft)}
            pushCount={draftPushLines(draft).length}
            result={result}
            onManualRate={(key, rate) => {
              setSaved((cur) => {
                if (!cur) return cur;
                const manualRates = { ...cur.manualRates };
                if (rate == null) delete manualRates[key]; else manualRates[key] = rate;
                return { ...cur, manualRates };
              });
              setResult('idle');
            }}
            onToggle={(key) => {
              setSaved((cur) => (cur ? { ...cur, excluded: cur.excluded.includes(key) ? cur.excluded.filter((k) => k !== key) : [...cur.excluded, key] } : cur));
              setResult('idle');
            }}
            onConfirm={() => void confirmDraft()}
          />
        )}
      </ScrollView>
      <EditMeasureSheet target={editTarget} copy={copy} onCancel={() => setEditing(null)} onSave={applyEdit} />
    </View>
  );
}
