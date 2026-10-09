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
// THE ORDER LIST (lane SCANORDER) is a fifth step, reached from The Quantities.
// It leaves this screen three ways, each ONLY from that way's confirm sheet:
// copied as text, handed to the share sheet as text, or put into the estimate
// as material lines through the same buildEstimatePatch. `sendOrder` asks the
// pure core for the record of the send first (orderListCore.confirmOrderSend,
// which refuses without `confirmed: true`) and does nothing without it.
// SENT A SECOND TIME, the same yes also takes out the lines an earlier send
// wrote that the list no longer has, and leaves alone any line he changed by
// hand in the estimate since (orderPricingCore.planOrderResend). The plan is
// worked out before the sheet opens, the sheet names every such line, and the
// patch the yes builds is handed that same plan.
// HIS TAPE: a typed wall length makes a scanned-and-taped pair, kept with the
// scan and, when he SAVES the scan, in his own list on this phone
// (utils/roomScan/learnStore). Nothing about it is uploaded or sent to a model.
// A scan the saved-list cap pushes off the phone takes its taped walls with it
// in the same save (`dropTape`).
//
// THE OWNER PREVIEW (lane SCANBUILD). Nobody had run the scanner when the first
// build that carries it was cut, and Apple does not document the JSON a
// CapturedRoom encodes to. So a finished scan is handled to be INFORMATIVE:
//   * the raw JSON is kept on the phone the moment the scanner closes, before
//     the parser runs (utils/roomScan/rawKeep), whether or not it can be read;
//   * a scan that cannot be read, or holds no walls, opens its own plain screen
//     (step 'unread') instead of a red line or a blank: what happened, and for
//     the owner the raw size, the top-level keys, the real error text and the
//     Share Raw Scan Data button;
//   * every way the scanner can end says something: a cancel, an interruption,
//     a refused camera, a session error, a build without the module;
//   * the owner sees Scan Facts on the plan: what the iPhone counted in Swift
//     beside what the file holds and what the app understood.
// `userEmail` is handed to every call into utils/roomScan/native, which refuses
// the lookup for anyone the gate refuses. `ownerTools` only shows extras.
//
// CLEARANCE CHECK (lane CLEARANCE) is a step reached from the plan: the
// distances an inspector commonly looks at, measured off the scan and set
// beside commonly used figures (utils/roomScan/clearanceCore). It is drawn
// only for someone the scanner's own gate lets in (utils/roomScan/allowed),
// asked again here with the signed-in email. It writes nothing, sends nothing,
// and no state it shows is read by anything else in this file: its one action
// opens the existing Code Check.
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
import { useAuth } from '@/contexts/AuthContext';
import { useProjects } from '@/contexts/ProjectContext';
import { useMaterialCart } from '@/contexts/MaterialCartContext';
import { useScopeCostBook } from '@/hooks/useScopeCostBook';
import { Button, Sheet } from '@/components/ui';
import { useRoomScanCopy } from '@/hooks/useRoomScanCopy';
import { useScanOrderCopy } from '@/hooks/useScanOrderCopy';
import { useScanClearanceCopy } from '@/hooks/useScanClearanceCopy';
import { codeCheckFromJobHref } from '@/utils/uxRoutes';
import { copyToClipboard } from '@/utils/clipboard';
import { shareText } from '@/utils/shareText';
import { formatCalendarDay, calendarDayOf, todayCalendarDay } from '@/utils/calendarDate';
import { formatTimeL } from '@/i18n/format';
import { generateUUID } from '@/utils/generateId';
import type { MarkupPct } from '@/utils/estimateMarkup';
import { scanRoomAllowed } from '@/utils/roomScan/allowed';
import { roomScanAvailability, type RoomScanAvailability } from '@/utils/roomScan/availability';
import { parseCapturedRoom, type ParsedRoom } from '@/utils/roomScan/capturedRoomParser';
import { makeCatalogRater } from '@/utils/roomScan/catalogRate';
import { buildClearanceCheck } from '@/utils/roomScan/clearanceCore';
import { correctCeilingHeight, correctOpening, correctWallLength, renameScan } from '@/utils/roomScan/editsCore';
import { buildRoomScan } from '@/utils/roomScan/geometryCore';
import { longWallSuggestion, tapeFacts, tapePairFromEdit, upsertTapePairs, type TapePair } from '@/utils/roomScan/learnCore';
import { forgetScanTapePairs, forgetScansTapePairs, loadTapePairs, recordTapePairs } from '@/utils/roomScan/learnStore';
import * as RoomScanNative from '@/utils/roomScan/native';
import {
  buildOrderList, confirmOrderSend, defaultOrderOptions, orderListText,
  type OrderOptions, type OrderSendVia,
} from '@/utils/roomScan/orderListCore';
import { buildOrderDraft, makeMaterialRater, orderAfterPush, orderDraftWithout, orderPriceSources, orderWroteFrom, planOrderResend } from '@/utils/roomScan/orderPricingCore';
import { buildEstimatePatch, buildScanDraft, draftBlock, draftPushLines, estimateHoldsPush, pushedLinesInEstimate, startsEstimate } from '@/utils/roomScan/pricingCore';
import { computeQuantities, scanFacts, scanPricingBlock } from '@/utils/roomScan/quantitiesCore';
import { keepRawScan, loadLastRawScan, loadRawScan, shareRawScanFile, type LastRawScan } from '@/utils/roomScan/rawKeep';
import { ROOM_RECIPES, type RecipeKey } from '@/utils/roomScan/recipesCore';
import { buildScanFacts, type ScanOutcome } from '@/utils/roomScan/scanDebugCore';
import { deleteScan, hashRawScan, loadSavedScans, saveScan } from '@/utils/roomScan/store';
import { withOrderSent, type SavedScan } from '@/utils/roomScan/storeCore';
import { RoomScanParseError, type RoomScan, type RoomType } from '@/utils/roomScan/types';
import { ClearanceView } from './ClearanceView';
import { EditMeasureSheet, type EditTarget } from './EditMeasureSheet';
import { FloorPlanView } from './FloorPlanView';
import { OrderListView, type OrderSendState } from './OrderListView';
import { PricedDraftView } from './PricedDraftView';
import { QuantitiesView } from './QuantitiesView';
import { ScanFactsPanel, type RawShareState } from './ScanFactsPanel';
import { makeRoomScanStyles } from './styles';

type Step = 'start' | 'unread' | 'plan' | 'clearance' | 'quantities' | 'order' | 'price';
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
  /** The signed-in person's email, for the gate in utils/roomScan/native (the lookup is refused without it while the flag is off). */
  userEmail?: string | null;
  /** The owner's extras: Scan Facts, Share Raw Scan Data, the real error text. */
  ownerTools?: boolean;
}

const emptySaved = (scan: RoomScan): SavedScan => ({ scan, pushed: {}, manualRates: {}, excluded: [], savedAt: '', pricedAt: null });

/** How long a confirmed push waits to see its lines on the project, in steps of KEPT_STEP_MS. */
const KEPT_TRIES = 15;
const KEPT_STEP_MS = 100;
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function RoomScanFlow({ projectId, mayEditEstimate, initial, userEmail = null, ownerTools = false }: RoomScanFlowProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeRoomScanStyles);
  const copy = useRoomScanCopy();
  const ocopy = useScanOrderCopy();
  const ccopy = useScanClearanceCopy();
  // Clearance Check is for whoever the scanner's gate lets in: the owner while the flag is off.
  const clearanceOn = scanRoomAllowed(userEmail);
  const { lang } = useT();
  const { user } = useAuth();
  const userId = user?.id ?? null;
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
  const materialCatalog = useMemo(() => makeMaterialRater(location), [location]);

  const [step, setStep] = useState<Step>(initial ? 'plan' : 'start');
  const [saved, setSaved] = useState<SavedScan | null>(initial ?? null);
  const [rawJson, setRawJson] = useState<string | null>(null);
  const [avail, setAvail] = useState<RoomScanAvailability>(() => roomScanAvailability(RoomScanNative.getCapabilities(userEmail)));
  const [busy, setBusy] = useState(false);
  /** How the last try ended when it did not end in a room: a cancel, or a stop with its code and the phone's own words. */
  const [scanEnd, setScanEnd] = useState<{ kind: 'cancelled' } | { kind: 'stopped'; code: string | null; text: string } | null>(null);
  /** The last finished scan on this phone: its facts and where its raw data is. Also read back after a crash. */
  const [last, setLast] = useState<LastRawScan | null>(null);
  const [rawKept, setRawKept] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [shareState, setShareState] = useState<RawShareState>(null);
  /** Apple's JSON for the scan just made, as the module returned it, held in memory so a share does not depend on the phone's storage. */
  const lastRawText = useRef<{ scanId: string; raw: string } | null>(null);
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
  /** His taped walls on this phone, across every saved scan. */
  const [tapeLog, setTapeLog] = useState<TapePair[]>([]);
  const [orderSend, setOrderSend] = useState<OrderSendState>('idle');
  const [orderBusy, setOrderBusy] = useState(false);

  const refreshSavedList = useCallback(async () => {
    const l = await loadSavedScans(projectId);
    setSavedList(l.scans);
  }, [projectId]);

  useEffect(() => {
    let live = true;
    void loadSavedScans(projectId).then((l) => { if (live) setSavedList(l.scans); });
    return () => { live = false; };
  }, [projectId]);

  useEffect(() => {
    let live = true;
    void loadTapePairs(userId).then((pairs) => { if (live) setTapeLog(pairs); });
    return () => { live = false; };
  }, [userId]);

  // The owner's last scan, read back from the phone: a scan that could not be
  // read, or one the app was closed on, can still be shared.
  useEffect(() => {
    if (!ownerTools) return undefined;
    let live = true;
    void loadLastRawScan().then((l) => { if (live && l) setLast((cur) => cur ?? l); });
    return () => { live = false; };
  }, [ownerTools]);

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

  // ── the order list: worked out again whenever the scan or a choice changes ──
  const orderOptions = useMemo<OrderOptions | null>(
    () => (saved ? saved.order ?? defaultOrderOptions(saved.scan.roomType) : null),
    [saved],
  );
  const orderList = useMemo(() => (scan && orderOptions ? buildOrderList(scan, orderOptions) : null), [scan, orderOptions]);
  const orderDraft = useMemo(() => {
    if (!saved || !orderList) return null;
    const names: Record<string, string> = {};
    for (const l of orderList.lines) names[l.key] = `${ocopy.lineName(l)}, ${saved.scan.name}`;
    return buildOrderDraft(saved.scan, orderList, db, materialCatalog, { manualRates: saved.orderRates, names });
  }, [saved, orderList, db, materialCatalog, ocopy]);
  // What the panel reads: his saved pairs plus the ones typed on the scan in hand.
  const tapePairs = useMemo(() => upsertTapePairs(tapeLog, saved?.tapePairs ?? []), [tapeLog, saved]);
  const tape = useMemo(() => tapeFacts(tapePairs), [tapePairs]);
  // Clearance Check: worked out again whenever the scan or his tape history changes. Nothing reads it but its own screen.
  const clearance = useMemo(() => (scan && clearanceOn ? buildClearanceCheck(scan, tapePairs) : null), [scan, clearanceOn, tapePairs]);
  // The same phone model as the scan in hand, when he has taped enough long walls with it (learnCore).
  const suggestion = useMemo(() => longWallSuggestion(tapePairs, scan?.device?.model ?? ''), [tapePairs, scan]);
  // What a second send of this list to the estimate would remove and what it would leave alone.
  const estimateNow = project?.linkedEstimate ?? null;
  const resend = useMemo(() => planOrderResend({
    estimate: estimateNow, scanId: saved?.scan.id ?? '', pushed: saved?.orderPushed, wrote: saved?.orderWrote,
    lines: orderDraft ? draftPushLines(orderDraft) : [],
  }), [estimateNow, saved, orderDraft]);
  const orderSendDraft = useMemo(() => (orderDraft ? orderDraftWithout(orderDraft, resend.skip) : null), [orderDraft, resend]);
  // A scan the cap pushed off the saved list takes its taped walls out of his list too.
  const dropTape = useCallback(async (scanIds: string[]) => {
    const log = await forgetScansTapePairs(userId, scanIds);
    if (log) setTapeLog(log);
  }, [userId]);

  const changeOrder = useCallback((fn: (cur: SavedScan) => SavedScan) => {
    setSaved((cur) => (cur ? fn(cur) : cur));
    setOrderSend('idle');
    setDirty(true);
  }, []);

  const change = useCallback((fn: (s: RoomScan) => RoomScan) => {
    setSaved((cur) => (cur ? { ...cur, scan: fn(cur.scan) } : cur));
    setSaveState('idle');
    setResult('idle');
    setDirty(true);
  }, []);

  // ── the scan ──
  const refreshAvailability = useCallback(() => setAvail(roomScanAvailability(RoomScanNative.getCapabilities(userEmail))), [userEmail]);
  const allowCamera = useCallback(async () => {
    try { await ImagePicker.requestCameraPermissionsAsync(); } catch { /* the sentence on screen already says what is needed */ }
    refreshAvailability();
  }, [refreshAvailability]);

  const startScan = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setScanEnd(null);
    setShareState(null);
    const scanId = generateUUID();
    try {
      const raw = await RoomScanNative.startScan(userEmail, { scanId, exportUsdz: false });
      if (raw.status !== 'done') { setScanEnd({ kind: 'cancelled' }); return; }
      const json = typeof raw.capturedRoomJson === 'string' ? raw.capturedRoomJson : '';
      const endedAt = raw.endedAt || new Date().toISOString();
      const rawSha256 = json ? await hashRawScan(json) : '';
      // Read it. Whatever happens here is an outcome with its real words, never a throw past this block.
      let parsed: ParsedRoom | null = null;
      let next: RoomScan | null = null;
      let outcome: ScanOutcome = 'read';
      let errorText = '';
      if (!json) {
        outcome = 'notEncoded';
        errorText = raw.encodeError ?? '';
      } else {
        try {
          parsed = parseCapturedRoom(json);
        } catch (e) {
          outcome = e instanceof RoomScanParseError && e.code === 'no_walls' ? 'noWalls' : 'unreadable';
          errorText = RoomScanNative.roomScanErrorText(e);
        }
        if (parsed) {
          try {
            next = buildRoomScan(parsed, {
              id: scanId,
              projectId,
              // No name yet. The field shows an example as its placeholder; the
              // scan itself is never called "Hall Bathroom" for him.
              name: '',
              capturedAt: endedAt,
              device: { model: raw.deviceModel ?? '', os: raw.roomPlanSdk ?? '' },
              warnings: raw.warnings ?? [],
              rawSha256,
            });
          } catch (e) {
            outcome = 'unreadable';
            errorText = RoomScanNative.roomScanErrorText(e);
          }
        }
      }
      const summary = raw.summary ?? null;
      const facts = buildScanFacts({
        scanId, projectId, raw: json, rawSha256, summary, parsed, outcome, errorText,
        osVersion: raw.roomPlanSdk ?? '', deviceModel: raw.deviceModel ?? '',
        startedAt: raw.startedAt ?? '', endedAt, durationSeconds: raw.durationSeconds ?? null, warnings: raw.warnings ?? [],
      });
      // Kept on the phone BEFORE the result is used for anything, read or not.
      lastRawText.current = { scanId, raw: json };
      const kept = await keepRawScan(json, facts, summary);
      setRawKept(kept);
      setLast({ version: 1, scanId, projectId, facts, summary });
      setRawJson(json || null);
      if (!next) {
        setSaved(null);
        setStep('unread');
        return;
      }
      setSaved(emptySaved(next));
      setSaveState('idle');
      setResult('idle');
      setDirty(true);
      setStep('plan');
    } catch (e) {
      // The module said no, or the scan stopped. Each code has its own sentence; the owner also sees the phone's own words.
      setScanEnd({ kind: 'stopped', code: RoomScanNative.roomScanErrorCode(e), text: RoomScanNative.roomScanErrorText(e) });
      refreshAvailability();
    } finally {
      setBusy(false);
    }
  }, [busy, projectId, refreshAvailability, userEmail]);

  // ── the raw scan as a file, only from a tap, only for the owner ──
  const shareRaw = useCallback(async () => {
    if (!ownerTools || !last || sharing) return;
    setSharing(true);
    try {
      // The text in memory when this is the scan on screen; otherwise what the phone kept.
      const held = lastRawText.current;
      const raw = held && held.scanId === last.scanId ? held.raw : await loadRawScan(last.scanId);
      const roomName = saved?.scan.id === last.scanId ? saved.scan.name : '';
      const res = await shareRawScanFile({
        facts: last.facts, summary: last.summary, raw, roomName,
        day: calendarDayOf(last.facts.at) ?? todayCalendarDay(), dialogTitle: copy.shareRawTitleLabel,
      });
      setShareState({ outcome: res.outcome, file: res.fileName, error: res.errorText });
    } finally {
      setSharing(false);
    }
  }, [ownerTools, last, sharing, saved, copy]);

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
    if (e.on === 'wall') {
      // The scanned and the taped length, kept as a pair, from the scan as it stood BEFORE this edit.
      setSaved((cur) => {
        if (!cur) return cur;
        const pair = tapePairFromEdit(cur.scan, e.id, metres, at, cur.tapePairs ?? []);
        return pair ? { ...cur, tapePairs: upsertTapePairs(cur.tapePairs ?? [], [pair]) } : cur;
      });
      change((s) => correctWallLength(s, e.id, metres, at));
    } else if (e.on === 'ceiling') change((s) => correctCeilingHeight(s, metres, at));
    else change((s) => correctOpening(s, e.id, e.field, metres, at));
  }, [editing, change]);

  // His taped walls go into his own list on this phone WITH a save of the scan, never before it.
  const keepTape = useCallback(async (s: SavedScan) => {
    const log = await recordTapePairs(userId, s.tapePairs ?? []);
    if (log) setTapeLog(log);
  }, [userId]);

  // ── saving, only from a tap ──
  const save = useCallback(async () => {
    if (!saved) return;
    if (!saved.scan.name.trim()) { setSaveState('needsName'); return; }
    const next: SavedScan = { ...saved, savedAt: new Date().toISOString() };
    const ok = await saveScan(next, rawJson, dropTape);
    setSaveState(ok ? 'saved' : 'failed');
    if (ok) { setSaved(next); setDirty(false); await refreshSavedList(); }
    if (ok) await keepTape(next);
  }, [saved, rawJson, refreshSavedList, keepTape, dropTape]);

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
      const stored = await saveScan(next, rawJson, dropTape);
      if (stored) { setDirty(false); await refreshSavedList(); }
      if (stored) await keepTape(next);
      setResult('added');
      router.push({ pathname: '/project-detail', params: { id: project.id, tile: 'linkedEstimate' } });
    } finally {
      setPushing(false);
    }
  }, [saved, draft, pushing, mayEditEstimate, project, markupPct, updateProject, rawJson, refreshSavedList, router, keepTape, dropTape]);

  // ── the order list leaving the screen: only from a confirm sheet's yes ──
  const sendOrder = useCallback(async (via: OrderSendVia, confirmed: true) => {
    if (!saved || !orderList || !orderDraft || !orderSendDraft || orderBusy) return;
    const snap = confirmOrderSend({ confirmed, via, list: orderList, at: new Date().toISOString() });
    if (!snap) { setOrderSend(via === 'copy' ? 'copyFailed' : via === 'share' ? 'shareFailed' : 'failed'); return; }
    if (via === 'copy' || via === 'share') {
      const text = orderListText(orderList, saved.scan.name, ocopy.text);
      if (via === 'copy') {
        const ok = await copyToClipboard(text);
        setOrderSend(ok ? 'copied' : 'copyFailed');
        if (ok) { setSaved((cur) => (cur ? withOrderSent(cur, snap) : cur)); setDirty(true); }
        return;
      }
      let outcome: Awaited<ReturnType<typeof shareText>> = 'failed';
      try { outcome = await shareText({ message: text }); } catch { outcome = 'failed'; }
      if (outcome === 'cancelled') { setOrderSend('idle'); return; }
      setOrderSend(outcome === 'shared' ? 'shared' : outcome === 'copied' ? 'sharedAsCopy' : 'shareFailed');
      if (outcome !== 'failed') { setSaved((cur) => (cur ? withOrderSent(cur, snap) : cur)); setDirty(true); }
      return;
    }
    // The lines the list no longer has come out in the same patch. A line he changed by hand is not in the draft and not in `remove`.
    const res = buildEstimatePatch({
      confirmed, mayEdit: mayEditEstimate, project, draft: orderSendDraft, pushed: saved.orderPushed ?? {},
      newId: generateUUID, markupPct, now: snap.at,
      after: orderAfterPush({ remove: resend.remove, sources: orderPriceSources(orderSendDraft) }),
    });
    if (!res || !project) { setOrderSend('failed'); return; }
    setOrderBusy(true);
    try {
      updateProject(project.id, res.patch);
      let kept = false;
      for (let i = 0; i < KEPT_TRIES && !kept; i++) {
        kept = estimateHoldsPush(getProjectRef.current(project.id) ?? null, res);
        if (!kept) await pause(KEPT_STEP_MS);
      }
      if (!kept) { setOrderSend('unconfirmed'); return; }
      // What each written line says now, so a later send can tell a line he has changed since.
      const orderWrote = { ...(saved.orderWrote ?? {}), ...orderWroteFrom(res, draftPushLines(orderSendDraft).map((l) => l.conditionId)) };
      for (const id of res.removedIds) delete orderWrote[id];
      const next: SavedScan = { ...withOrderSent(saved, snap), orderPushed: res.pushed, orderWrote, savedAt: snap.at };
      setSaved(next);
      const stored = await saveScan(next, rawJson, dropTape);
      if (stored) { setDirty(false); await refreshSavedList(); }
      if (stored) await keepTape(next);
      setOrderSend('added');
      router.push({ pathname: '/project-detail', params: { id: project.id, tile: 'linkedEstimate' } });
    } finally {
      setOrderBusy(false);
    }
  }, [saved, orderList, orderDraft, orderBusy, orderSendDraft, resend, ocopy, mayEditEstimate, project, markupPct, updateProject, rawJson, refreshSavedList, keepTape, dropTape, router]);

  // ── deleting a saved scan, only from its confirm sheet ──
  const confirmDelete = useCallback(async () => {
    const target = deleting;
    setDeleting(null);
    if (!target) return;
    const ok = await deleteScan(projectId, target.scan.id);
    setDeleteFailed(!ok);
    await refreshSavedList();
    if (ok) {
      // A deleted scan takes its taped walls out of his list too.
      await forgetScanTapePairs(userId, target.scan.id);
      setTapeLog(await loadTapePairs(userId));
    }
  }, [deleting, projectId, refreshSavedList, userId]);

  const leavePlan = useCallback(() => {
    setLeaving(false);
    setDirty(false);
    if (initial) { router.back(); return; }
    setSaved(null);
    setRawJson(null);
    setStep('start');
  }, [initial, router]);

  const back = useCallback(() => {
    if (step === 'price' || step === 'order') setStep('quantities');
    else if (step === 'quantities' || step === 'clearance') setStep('plan');
    // Leaving the plan drops whatever the phone does not hold. Ask first.
    else if (step === 'plan' && dirty) setLeaving(true);
    else if (step === 'plan') leavePlan();
    else if (step === 'unread') { setRawJson(null); setStep('start'); }
    else router.back();
  }, [step, dirty, leavePlan, router]);

  const title = step === 'plan' && scan ? (scan.name || copy.titleLabel)
    : step === 'quantities' ? copy.quantitiesTitleLabel
    : step === 'price' ? copy.draftTitleLabel
    : step === 'order' ? ocopy.titleLabel
    : step === 'clearance' ? ccopy.titleLabel
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
                {scanEnd?.kind === 'cancelled' && <Text style={styles.note} testID="scan-ended-cancelled">{copy.cancelledBody}</Text>}
                <Button label={copy.startScanLabel} variant="primary" onPress={() => void startScan()} loading={busy} testID="scan-start-button" />
              </>
            ) : (
              <View style={styles.blocked} testID={`scan-unavailable-${avail.reason}`}>
                <Text style={styles.blockedText}>{copy.unavailableBody(avail.reason ?? 'notInThisBuild')}</Text>
                {avail.action === 'none' && <Text style={styles.blockedText}>{copy.otherWaysBody}</Text>}
              </View>
            )}
            {/* A stop is said whether or not the phone can still scan: a refused camera turns the start into the Open Settings block. */}
            {scanEnd?.kind === 'stopped' && (
              <View style={styles.blocked} testID={`scan-ended-${scanEnd.code ?? 'unknown'}`}>
                <Text style={styles.blockedText}>{copy.scanStoppedBody(scanEnd.code)}</Text>
                {ownerTools && !!scanEnd.text && <Text style={styles.blockedText} selectable testID="scan-ended-text">{copy.phoneSaidSub(scanEnd.text)}</Text>}
              </View>
            )}
            {avail.action === 'requestCamera' && <Button label={copy.allowCameraLabel} variant="primary" onPress={() => void allowCamera()} testID="scan-allow-camera" />}
            {avail.action === 'openSettings' && <Button label={copy.openSettingsLabel} variant="secondary" onPress={() => void Linking.openSettings()} testID="scan-open-settings" />}

            {ownerTools && last && (
              <>
                <Text style={styles.cardHeading}>{copy.lastScanHeadingLabel}</Text>
                <Text style={styles.note}>{copy.lastScanSub(formatCalendarDay(calendarDayOf(last.facts.at), undefined, lang), formatTimeL(last.facts.at, lang))}</Text>
                <ScanFactsPanel facts={last.facts} copy={copy} styles={styles} rawKept sharing={sharing} shareState={shareState} onShare={() => void shareRaw()} />
              </>
            )}
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
        {step === 'unread' && last && (
          <View style={styles.body} testID={`scan-unread-${last.facts.outcome}`}>
            <View style={styles.blocked}>
              <Text style={styles.blockedText}>{copy.unreadBody(last.facts.outcome === 'read' ? 'unreadable' : last.facts.outcome)}</Text>
              <Text style={styles.blockedText}>{copy.unreadNextBody(ownerTools)}</Text>
            </View>
            {ownerTools && (
              <ScanFactsPanel facts={last.facts} copy={copy} styles={styles} rawKept={rawKept} sharing={sharing} shareState={shareState} onShare={() => void shareRaw()} />
            )}
            <Button label={copy.scanAgainLabel} variant="primary" onPress={() => { setRawJson(null); setStep('start'); }} testID="scan-unread-again" />
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
            clearance={clearanceOn ? { label: ccopy.openLabel, onPress: () => setStep('clearance') } : undefined}
          />
        )}
        {step === 'plan' && scan && quantities && ownerTools && last && last.scanId === scan.id && (
          <View style={styles.body} testID="scan-plan-facts">
            <ScanFactsPanel facts={last.facts} copy={copy} styles={styles} rawKept={rawKept} sharing={sharing} shareState={shareState} onShare={() => void shareRaw()} />
          </View>
        )}
        {step === 'clearance' && clearanceOn && scan && clearance && (
          <ClearanceView
            scan={scan}
            check={clearance}
            copy={ccopy}
            onOpenCodeCheck={() => router.push(codeCheckFromJobHref(projectId))}
          />
        )}
        {step === 'quantities' && scan && quantities && (
          <QuantitiesView
            quantities={quantities}
            copy={copy}
            block={scanPricingBlock(scan, quantities)}
            onPrice={() => setStep('price')}
            order={{ label: ocopy.openLabel, onPress: () => { setOrderSend('idle'); setStep('order'); } }}
          />
        )}
        {step === 'order' && saved && orderList && orderDraft && orderSendDraft && orderOptions && (
          <OrderListView
            roomName={saved.scan.name}
            list={orderList}
            draft={orderDraft}
            copy={copy}
            ocopy={ocopy}
            tape={tape}
            suggestion={suggestion}
            block={draftBlock(project, orderSendDraft, { mayEdit: mayEditEstimate, markupPct })}
            pushCount={draftPushLines(orderSendDraft).length}
            starting={startsEstimate(project)}
            markupPct={markupPct}
            installedAlreadyIn={pushedLinesInEstimate(project, saved.pushed) > 0}
            resend={{ again: Object.keys(saved.orderPushed ?? {}).length > 0, remove: resend.remove.map((r) => r.name), leftAlone: resend.leftAlone.map((r) => r.name) }}
            sendState={orderSend}
            busy={orderBusy}
            onOptions={(patch) => changeOrder((cur) => ({ ...cur, order: { ...(cur.order ?? defaultOrderOptions(cur.scan.roomType)), ...patch } }))}
            onTypedQuantity={(key, quantity) => changeOrder((cur) => {
              const order = cur.order ?? defaultOrderOptions(cur.scan.roomType);
              const typed = { ...order.typed };
              if (quantity == null) delete typed[key]; else typed[key] = quantity;
              return { ...cur, order: { ...order, typed } };
            })}
            onManualRate={(key, rate) => changeOrder((cur) => {
              const orderRates = { ...(cur.orderRates ?? {}) };
              if (rate == null) delete orderRates[key]; else orderRates[key] = rate;
              return { ...cur, orderRates };
            })}
            onSend={(via, confirmed) => void sendOrder(via, confirmed)}
          />
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
            materialsAlreadyIn={pushedLinesInEstimate(project, saved.orderPushed) > 0}
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
