// app/punch-pin.tsx — "Pin items": pin every item on the plan AFTER its photo.
//
// The founder, 2026-09-18: "i want to be able to pin the location of each item
// before and after taking photos where is that ability?" His 63 real items came
// from the Photo walk, which never pins, and nothing could pin an existing
// item. This screen walks every unpinned item on the list, one at a time, in
// the PDF's own numbering: the photo (with his markup), #14, the description
// and where he said it is → tap the spot → Save pin · next. Skip, Back, Undo,
// "12 of 63 pinned", and the sheet chips for a multi-floor job.
//
// What it leans on, so nothing here is new mechanism:
//   • components/punch/PlanPinStep, rendered inline (presentation="screen")
//     and NOT remounted per item: `itemKey` resets the pin while the plan's
//     zoom and scroll stay where he was working. It is the one place a tap
//     becomes a pin — this file does no geometry;
//   • utils/punchPinQueue — which items, their order and numbers (the
//     export's), the cursor (a pure reducer), the height budget;
//   • hooks/usePunchPinWriter — the one write path (ProjectContext actions,
//     so every pin is local at once and queued for the server; Undo reverses
//     the item and any linked plan-viewer marker).
// No plan yet: the step itself opens on "No floor plan on this job yet" with
// photograph / choose / import a PDF, and a device-only sheet asks to be saved.
// Guard: scripts/validate-punch-pin-items.ts.

import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, Platform, ActivityIndicator, useWindowDimensions, type LayoutChangeEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { MapPinned, MapPinPlus, Map as PlanIcon, ChevronLeft, Undo2, RotateCcw } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useProjects } from '@/contexts/ProjectContext';
import { useProjectAccess } from '@/hooks/useProjectAccess';
import { useProjectRoleState } from '@/hooks/useProjectRole';
import { useTierAccess } from '@/hooks/useTierAccess';
import { usePunchPinWriter } from '@/hooks/usePunchPinWriter';
import { useBrainFabLift, useHideBrainFab } from '@/components/brain/brainFabState';
import Paywall from '@/components/Paywall';
import { ToolProjectPicker } from '@/components/ToolScreenChrome';
import { Button } from '@/components/ui';
import PlanPinStep from '@/components/punch/PlanPinStep';
import { PinQueueCard, PinQueueNav } from '@/components/punch/PinQueueCard';
import PunchPhotoViewer from '@/components/punch/PunchPhotoViewer';
import { markupForSource, sourcePhotoIdOf } from '@/components/PhotoMarkupOverlay';
import { punchListTypeOf, type PunchListType } from '@/types';
import { punchItemNumbers } from '@/utils/punchExportCore';
import { durablePinSheetCount, pdfImportBlockedReason, pinSheetLabel, type WalkPin } from '@/utils/punchPlanPin';
import {
  buildPinQueue, initialPinQueueSession, isPinnedForExport, nextOpenIndex, parsePinQueueIds, pinQueueLayout,
  pinQueueProgress, pinRefOf, pinScopeStats, pinSeedFor, pinWriteBlockedReason, prevIndex, reducePinQueue, sheetsByIdOf,
  type PinQueueEnv, type PinWrite,
} from '@/utils/punchPinQueue';
import { peekPinQueueIds } from '@/utils/pinQueueHandoff';

const LIST_WORDS: Record<PunchListType, string> = { punch: 'punch list', crew: 'crew list' };

export default function PunchPinScreen() {
  const router = useRouter();
  // Read the project from params here so the gate can ask "were they invited
  // to THIS project?" before paywalling (the punch list's own gate).
  const { projectId: gateProjectId } = useLocalSearchParams<{ projectId?: string }>();
  const { canAccess } = useProjectAccess(gateProjectId);
  if (!canAccess('punch_list_closeout')) {
    return (
      <Paywall
        visible={true}
        feature="Punch List & Closeout"
        requiredTier="business"
        onClose={() => (router.canGoBack() ? router.back() : router.replace('/punch-list' as never))}
      />
    );
  }
  return <PunchPinScreenInner />;
}

function PunchPinScreenInner() {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const params = useLocalSearchParams<{ projectId?: string; list?: string; batch?: string; ids?: string }>();
  const { projects, getProject, projectsLoaded } = useProjects();
  const [pickedProjectId, setPickedProjectId] = useState<string | null>(null);
  const paramProjectId = typeof params.projectId === 'string' ? params.projectId : '';
  const projectId = pickedProjectId ?? paramProjectId ?? '';
  const project = projectId ? getProject(projectId) : undefined;
  const staleProjectId = !project && paramProjectId ? paramProjectId : undefined;
  const list = punchListTypeOf({ listType: (typeof params.list === 'string' ? params.list : undefined) as PunchListType | undefined });

  if (!project) {
    return (
      <View style={[styles.root, { backgroundColor: t.bg }]}>
        <Stack.Screen options={{ headerShown: true, title: 'Pin items' }} />
        {!projectsLoaded ? (
          <View style={styles.center} testID="pin-queue-loading-job">
            <ActivityIndicator color={t.textMuted} />
            <Text style={styles.body}>Loading this job{'…'}</Text>
          </View>
        ) : (
          <ToolProjectPicker
            toolName="Pin items"
            message="Pick the job whose punch items you want to pin on the plan."
            projects={projects}
            onPick={setPickedProjectId}
            staleProjectId={staleProjectId}
          />
        )}
      </View>
    );
  }

  return (
    <PinItems
      key={projectId}
      projectId={projectId}
      list={list}
      batchToken={typeof params.batch === 'string' ? params.batch : undefined}
      idsParam={params.ids}
    />
  );
}

function PinItems({ projectId, list, batchToken, idsParam }: {
  projectId: string;
  list: PunchListType;
  batchToken?: string;
  idsParam?: string | string[];
}) {
  const router = useRouter();
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  // The canvas is a touch responder: the floating Brain button must not sit on it.
  useHideBrainFab();
  const [footerH, setFooterH] = useState(0);
  useBrainFabLift(footerH);

  const { getPunchItemsForProject, getPlanSheetsForProject, drawingPins, projectPhotos, punchItemsLoaded, planSheetsLoaded } = useProjects();
  const roleState = useProjectRoleState(projectId);
  const tier = useTierAccess();
  const { writePin, undoPin } = usePunchPinWriter(projectId);

  const exit = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace({ pathname: '/punch-list' as never, params: { projectId, list } as never });
  }, [router, projectId, list]);

  // ── Data ────────────────────────────────────────────────────────────────
  // Both lists, exactly what the export numbers — so #14 here is #14 in the PDF.
  const allItems = useMemo(() => getPunchItemsForProject(projectId), [getPunchItemsForProject, projectId]);
  const sheets = useMemo(() => getPlanSheetsForProject(projectId), [getPlanSheetsForProject, projectId]);
  const sheetsById = useMemo(() => sheetsByIdOf(sheets), [sheets]);
  const numbers = useMemo(() => punchItemNumbers(allItems), [allItems]);
  const itemsById = useMemo(() => new Map(allItems.map(i => [i.id, i] as const)), [allItems]);

  const batchIds = useMemo(() => peekPinQueueIds(batchToken), [batchToken]);
  const batchLost = !!batchToken && batchIds === null;
  const scopeIds = useMemo(() => {
    if (batchIds) return batchIds;
    const parsed = parsePinQueueIds(idsParam);
    return parsed.length > 0 ? parsed : null;
  }, [batchIds, idsParam]);

  const live = useMemo(() => buildPinQueue({ allItems, sheets, list, ids: scopeIds }), [allItems, sheets, list, scopeIds]);
  const liveIds = useMemo(() => live.map(e => e.id), [live]);
  const liveKey = liveIds.join(',');
  const env: PinQueueEnv = useMemo(() => ({
    exists: new Set(allItems.map(i => i.id)),
    pinned: new Set(allItems.filter(i => isPinnedForExport(i, sheetsById)).map(i => i.id)),
  }), [allItems, sheetsById]);

  const [session, dispatch] = useReducer(reducePinQueue, liveIds, initialPinQueueSession);
  // Keyed on the joined ids: a new array with the same ids is not a change.
  useEffect(() => {
    dispatch({ type: 'live', ids: liveIds });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveKey]);
  // The item under the cursor was deleted (another phone, or the punch list): move on.
  const cursorId = session.ids[session.index];
  useEffect(() => {
    if (cursorId && !env.exists.has(cursorId)) dispatch({ type: 'current-gone', env });
  }, [cursorId, env]);

  // The header's count is the whole list (or batch), like the punch list's card.
  const scopeStats = useMemo(() => pinScopeStats({ allItems, sheetsById, list, ids: scopeIds }), [allItems, sheetsById, list, scopeIds]);

  // Web keys only while this screen is on top: "Import a PDF plan set" pushes
  // /plans over it, and a document-level Cmd+Z there undid a pin he could not see.
  const [focused, setFocused] = useState(true);
  useFocusEffect(useCallback(() => {
    setFocused(true);
    return () => setFocused(false);
  }, []));

  const [photoCollapsed, setPhotoCollapsed] = useState(false);
  const [viewer, setViewer] = useState(false);
  const [rootWidth, setRootWidth] = useState(windowWidth);
  const onRootLayout = useCallback((e: LayoutChangeEvent) => setRootWidth(e.nativeEvent.layout.width), []);
  const layout = pinQueueLayout({ windowHeight, rootWidth, isWeb: Platform.OS === 'web', photoCollapsed });

  const current = cursorId ? itemsById.get(cursorId) : undefined;
  const progress = pinQueueProgress(session, env);
  const seed = useMemo(() => (current ? pinSeedFor(current, sheetsById, drawingPins) : null), [current, sheetsById, drawingPins]);
  const currentId = current?.id;
  const hideIds = useMemo(() => (currentId ? [currentId] : []), [currentId]);
  const hasDurablePlan = durablePinSheetCount(sheets, projectId) > 0;
  const pinBlocked = pinWriteBlockedReason(roleState.role, roleState);
  const pdfBlocked = pdfImportBlockedReason(tier.canAccess('plan_markup'));
  const openAfter = useCallback((id: string) => env.exists.has(id) && !env.pinned.has(id) && !session.pinnedThisSession.includes(id), [env, session.pinnedThisSession]);

  const goBack = useCallback(() => dispatch({ type: 'back', env }), [env]);
  const lastWrite = session.history[session.history.length - 1];
  // The history as the reducer will see it, kept in step synchronously. Two
  // Undos before a re-render read the same render's `lastWrite`: both reversed
  // write N while the reducer popped N and N-1 — N-1 marked undone, its pin
  // still on the plan. Each Undo takes its write from here and pops it here.
  const historyRef = useRef<readonly PinWrite[]>(session.history);
  historyRef.current = session.history;
  const undoLast = useCallback(() => {
    const h = historyRef.current;
    const w = h[h.length - 1];
    if (!w) return;
    historyRef.current = h.slice(0, -1);
    undoPin(w);
    dispatch({ type: 'undo', env });
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, [undoPin, env]);

  const handleNext = useCallback((pin: WalkPin) => {
    if (!current) return;
    const w = writePin(current, pin);
    dispatch(w
      ? { type: 'saved', itemId: current.id, write: w, env }
      : { type: 'kept', itemId: current.id, sheetId: pin.sheetId, env });
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [current, writePin, env]);

  const handleSkip = useCallback(({ hadPlan }: { hadPlan: boolean }) => {
    if (!current) return;
    if (hadPlan) dispatch({ type: 'skip', itemId: current.id, env });
    else exit();
  }, [current, env, exit]);

  const openImportPdf = useCallback(() => {
    router.push({ pathname: '/plans' as never, params: { projectId } as never });
  }, [router, projectId]);

  const listWord = LIST_WORDS[list];

  // ── States before the walk ──────────────────────────────────────────────
  const frame = (content: React.ReactNode, testID: string) => (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]} testID={testID}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.center}>{content}</View>
    </View>
  );

  // Both: "pinned" is judged against the sheet list, so before the sheets land
  // every pinned item reads as unpinned and would be queued again.
  if (!punchItemsLoaded || !planSheetsLoaded) {
    return frame(
      <>
        <ActivityIndicator color={t.textMuted} />
        <Text style={styles.body}>{!punchItemsLoaded ? 'Loading the punch list' : 'Loading the plan sheets'}{'…'}</Text>
      </>,
      'pin-queue-loading',
    );
  }

  if (pinBlocked) {
    return frame(
      <>
        <Text style={styles.title}>{roleState.role === 'viewer' ? 'View-only access' : 'Pins can’t be saved'}</Text>
        <Text style={styles.body}>{pinBlocked}</Text>
        <Button label="Back" variant="secondary" onPress={exit} iconLeft={<ChevronLeft size={16} color={t.text} strokeWidth={2} />} testID="pin-queue-exit" />
      </>,
      'pin-queue-viewonly',
    );
  }

  if (session.ids.length === 0) {
    const onList = allItems.filter(i => punchListTypeOf(i) === list);
    const otherList: PunchListType = list === 'punch' ? 'crew' : 'punch';
    const otherUnpinned = allItems.filter(i => punchListTypeOf(i) === otherList && !isPinnedForExport(i, sheetsById)).length;
    const lastPinnedSheet = onList.map(i => pinRefOf(i, sheetsById)).find(r => r.state === 'pinned');
    // A batch or ids= link this phone cannot see (not synced yet, or deleted):
    // never "every item in this batch is pinned" about items it does not have.
    if (scopeIds && scopeStats.missing > 0) {
      const none = scopeStats.total === 0;
      return frame(
        <>
          <Text style={styles.title}>
            {none
              ? `${scopeStats.missing === 1 ? 'This item isn’t' : `These ${scopeStats.missing} items aren’t`} on this phone yet`
              : `${scopeStats.total} pinned · ${scopeStats.missing} not on this phone yet`}
          </Text>
          <Text style={styles.body}>They may still be syncing from another phone, or they were deleted. Nothing here says whether they are pinned.</Text>
          <Button
            label={`Pin the unpinned items on the ${listWord}`}
            onPress={() => router.replace({ pathname: '/punch-pin' as never, params: { projectId, list } as never })}
            iconLeft={<MapPinned size={16} color={Colors.textOnAccent} strokeWidth={2} />}
            testID="pin-queue-scope-missing-all"
          />
          <Button label="Back to the punch list" variant="secondary" onPress={exit} testID="pin-queue-exit" />
        </>,
        'pin-queue-scope-missing',
      );
    }
    if (onList.length === 0 && !scopeIds) {
      return frame(
        <>
          <Text style={styles.title}>No items on the {listWord} yet</Text>
          <Text style={styles.body}>Pin first: tap the spot on the plan, take the photo, then say what{'’'}s wrong.</Text>
          <Button
            label="Pin first"
            onPress={() => router.replace({ pathname: '/punch-walk' as never, params: { projectId, list, start: 'pin' } as never })}
            iconLeft={<MapPinPlus size={16} color={Colors.textOnAccent} strokeWidth={2} />}
            testID="pin-queue-pin-first"
          />
          <Button label="Back" variant="secondary" onPress={exit} testID="pin-queue-exit" />
        </>,
        'pin-queue-empty',
      );
    }
    return frame(
      <>
        <MapPinned size={28} color={t.successLabel} strokeWidth={1.75} />
        <Text style={styles.title}>
          {scopeIds ? 'Every item in this batch is pinned' : `Every item on the ${listWord} is pinned (${onList.length})`}
        </Text>
        {lastPinnedSheet && lastPinnedSheet.state === 'pinned' && (
          <Button
            label="View on the plan"
            variant="secondary"
            onPress={() => router.push({ pathname: '/plan-viewer' as never, params: { sheetId: lastPinnedSheet.sheetId } as never })}
            iconLeft={<PlanIcon size={16} color={t.text} strokeWidth={2} />}
            testID="pin-queue-view-plan"
          />
        )}
        {!scopeIds && otherUnpinned > 0 && (
          <Button
            label={`Pin the ${otherUnpinned} ${LIST_WORDS[otherList]} item${otherUnpinned === 1 ? '' : 's'}`}
            onPress={() => router.replace({ pathname: '/punch-pin' as never, params: { projectId, list: otherList } as never })}
            iconLeft={<MapPinned size={16} color={Colors.textOnAccent} strokeWidth={2} />}
            testID="pin-queue-other-list"
          />
        )}
        <Button label="Back to the punch list" variant="secondary" onPress={exit} testID="pin-queue-exit" />
      </>,
      'pin-queue-nothing',
    );
  }

  if (session.index < session.ids.length && (!current || !seed)) {
    // The item under the cursor just left (deleted elsewhere); the effect
    // above moves on next frame — never flash "All pinned" meanwhile.
    return frame(<ActivityIndicator color={t.textMuted} />, 'pin-queue-moving');
  }

  if (session.index >= session.ids.length || !current || !seed) {
    const skipped = session.skipped.filter(id => openAfter(id)).length;
    const lastNumber = lastWrite ? numbers.get(lastWrite.itemId) : undefined;
    const lastSheetId = session.lastSheetId;
    return frame(
      <>
        <MapPinned size={28} color={t.successLabel} strokeWidth={1.75} />
        <Text style={styles.title}>
          {scopeStats.unpinned === 0
            ? `All ${scopeStats.total} pinned`
            : `${scopeStats.pinned} of ${scopeStats.total} pinned${skipped > 0 ? ` · ${skipped} skipped` : ''}`}
        </Text>
        <Text style={styles.body}>The punch list export draws these on its plan pages.</Text>
        {skipped > 0 && (
          <Button
            label={`Pin the ${skipped} skipped`}
            onPress={() => dispatch({ type: 'restart-skipped', env })}
            iconLeft={<RotateCcw size={16} color={Colors.textOnAccent} strokeWidth={2} />}
            testID="pin-queue-restart-skipped"
          />
        )}
        {lastSheetId && (
          <Button
            label="View on the plan"
            variant="secondary"
            onPress={() => router.push({ pathname: '/plan-viewer' as never, params: { sheetId: lastSheetId } as never })}
            iconLeft={<PlanIcon size={16} color={t.text} strokeWidth={2} />}
            testID="pin-queue-view-plan"
          />
        )}
        <Button label="Back to the punch list" variant="secondary" onPress={exit} testID="pin-queue-exit" />
        {lastWrite && lastNumber !== undefined && (
          <Button
            label={`Undo #${lastNumber}`}
            variant="ghost"
            onPress={undoLast}
            iconLeft={<Undo2 size={16} color={t.accent} strokeWidth={2} />}
            testID="pin-queue-done-undo"
          />
        )}
      </>,
      'pin-queue-done',
    );
  }

  // ── The walk ────────────────────────────────────────────────────────────
  const number = numbers.get(current.id) ?? 0;
  const ref = pinRefOf(current, sheetsById);
  const pinnedNow = ref.state === 'pinned';
  const isLast = nextOpenIndex(session.ids, session.index, id => openAfter(id) && id !== current.id) >= session.ids.length;
  const backAt = prevIndex(session.ids, session.index, id => env.exists.has(id));
  const backNumber = backAt >= 0 ? numbers.get(session.ids[backAt]) ?? null : null;
  const undoNumber = lastWrite ? numbers.get(lastWrite.itemId) ?? null : null;
  const markup = markupForSource(projectPhotos, sourcePhotoIdOf(current), current.photoUri);
  const seedSheet = seed.initialSheetId ? sheetsById.get(seed.initialSheetId) : undefined;
  const cardProps = {
    item: current,
    number,
    position: progress.position,
    total: progress.total,
    markup,
    seedSource: seed.source,
    sheetMissing: ref.state === 'sheet-missing',
    seedSheetLabel: seedSheet ? pinSheetLabel(seedSheet) : null,
    pinned: pinnedNow,
    onOpenPhoto: () => setViewer(true),
  };
  const batchNote = batchLost ? (
    <Text style={styles.batchNote} testID="pin-queue-batch-note">
      Showing every unpinned item on the {listWord} {'—'} the photo-walk batch is only kept until the app reloads.
    </Text>
  ) : null;

  return (
    <View style={styles.root} onLayout={onRootLayout} testID="pin-queue">
      <Stack.Screen options={{ headerShown: false }} />
      <PlanPinStep
        visible
        presentation="screen"
        projectId={projectId}
        itemKey={current.id}
        title="Pin items"
        closeLabel="Done — back to the punch list"
        // List-wide (the card's "item 3 of 43" is the queue position).
        subtitlePrefix={`${scopeStats.pinned} of ${scopeStats.total} pinned`}
        progress={{ value: scopeStats.pinned, max: scopeStats.total }}
        initialPin={seed.initialPin}
        initialSheetId={seed.initialSheetId}
        sessionSheetId={session.lastSheetId}
        sessionItemIds={session.pinnedThisSession}
        hideItemIds={hideIds}
        topSlot={layout.mode === 'strip' ? (
          <>
            {batchNote}
            <PinQueueCard
              layout="strip"
              photoSize={layout.photoSize}
              collapsed={photoCollapsed}
              onToggleCollapsed={() => setPhotoCollapsed(v => !v)}
              {...cardProps}
            />
          </>
        ) : undefined}
        sidePane={layout.mode === 'pane' ? (
          <View style={{ width: layout.paneWidth ?? undefined }}>
            {batchNote}
            <PinQueueCard layout="pane" width={layout.paneWidth} photoSize={layout.photoSize} collapsed={false} {...cardProps} />
          </View>
        ) : undefined}
        footerLeading={<PinQueueNav backNumber={backNumber} undoNumber={undoNumber} onBack={goBack} onUndo={undoLast} />}
        onFooterLayout={setFooterH}
        showHint={Platform.OS === 'web' || session.history.length === 0}
        webShortcuts={viewer || !focused ? null : { onBack: goBack, onUndo: undoLast }}
        nextLabel={pinnedNow ? 'Save · next' : isLast ? 'Save pin · done' : 'Save pin · next'}
        skipLabel={hasDurablePlan ? 'Skip' : 'Not now'}
        skipHint={hasDurablePlan ? 'Skip to leave this item unpinned for now' : 'Not now to leave Pin items'}
        onNext={(pin) => handleNext(pin)}
        onSkip={handleSkip}
        onClose={exit}
        onImportPdf={openImportPdf}
        importPdfBlockedReason={pdfBlocked}
      />
      <PunchPhotoViewer
        visible={viewer}
        uri={current.photoUri}
        markup={markup}
        caption={[`#${number}`, current.description, current.location].filter(Boolean).join('  ·  ')}
        onClose={() => setViewer(false)}
      />
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: t.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 28 },
  title: { ...Type.serifHeadline, color: t.text, textAlign: 'center' },
  body: { fontSize: Type.footnote.fontSize, color: t.textSecondary, textAlign: 'center', lineHeight: 19 },
  batchNote: {
    fontSize: Type.caption1.fontSize, color: t.warningLabel, paddingHorizontal: 12, paddingVertical: 6,
    backgroundColor: t.bg, borderBottomWidth: 1, borderBottomColor: t.line,
  },
});
