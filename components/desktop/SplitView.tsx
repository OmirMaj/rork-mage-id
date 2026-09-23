// components/desktop/SplitView.tsx — the list beside the record.
//
// WHY THIS EXISTS. On the web app every register (RFIs, submittals, change
// orders, invoices, dailies, COIs, subs, leads, documents) opens a record by
// PUSHING a full-width screen, so the list the GC was working through vanishes
// and each record is a round trip. The founder already asked for this shape
// once — the 75/25 punch split of 2026-09-22 (utils/punchEditLayout.ts). This
// is that idea as one primitive.
//
//   container ≥ 1100 (desktop)  list | divider | record, side by side. The
//                               list is ≥ 420 px, 42 % by default, ≤ 60 %;
//                               the divider drags and the position is saved
//                               per split id (`mageid_split_<id>`).
//   container < 1100 (desktop)  one pane: the record REPLACES the list, with a
//                               "Back to list" link. The list stays mounted,
//                               only hidden, so its search / sort / scroll and
//                               its j/k survive the round trip. While hidden
//                               it gets NO other key (SplitListHiddenContext):
//                               one Esc closes the record.
//   switching between the two   the list is the same node at the same place
//                               in the tree in both modes, so it is restyled,
//                               never remounted (see the render below).
//   phone                       the list only, exactly as passed. Opening a
//                               record is the screen's push navigation, as
//                               today (useSplitRecord does it for you).
//
// THE OPEN RECORD LIVES IN THE URL (useSplitRecord): the route's own record
// param (e.g. `rfiId`) or `?rec=`, written with router.setParams — so Back,
// refresh and a pasted link all land on the same record. Esc closes it.
//
// j/k BELONG TO THE LIST, NOT TO SplitView. Stepping to "the next record"
// means the next row he SEES — after the table's own sort and search, which
// live inside the DataTable. SplitView cannot know that order, so it binds no
// j/k at all (an earlier version stepped a screen-supplied id list and, on a
// sorted or searched table, opened the row above, or one the search had
// hidden). Put a DataTable in `list` with `activeKey={openId}` and
// `onRowOpen={(r) => open(id)}`: it steps the open record in visible order.
//
// Esc: with the list VISIBLE (split mode) the table's Esc (clear selection,
// then search) outranks this one by hotkey priority, so Esc closes the record
// only once the table has nothing left to clear — the same result whatever
// order he did things in. With the list HIDDEN (single mode, record open) the
// table's Esc is off, so the first Esc closes the record he is looking at.
//
// Width math: utils/splitViewLayout.ts (validated by
// scripts/validate-desktop-workspace.ts).

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, Platform, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { Layout, Tokens } from '@/constants/designTokens';
import { Type } from '@/constants/typography';
import type { ThemeColors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useContainerWidth } from '@/hooks/useContainerWidth';
import { useHotkeys } from '@/hooks/useHotkeys';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';
import {
  SPLIT_DIVIDER,
  SPLIT_LIST_DEFAULT_RATIO,
  dragSplitRatio,
  parseStoredRatio,
  splitMode,
  splitRatioKey,
  splitWidths,
} from '@/utils/splitViewLayout';

/** Web: the resize cursor tells him the line moves. RN's ViewStyle only types
 *  'auto' | 'pointer'; react-native-web passes any CSS cursor through. */
const RESIZE_CURSOR: ViewStyle | null = Platform.OS === 'web'
  ? ({ cursor: 'col-resize' } as unknown as ViewStyle)
  : null;

/**
 * True while the list is mounted but NOT on screen: single mode (container
 * < 1100) with a record filling the pane. A DataTable inside reads it and
 * turns off every key except record stepping (j/k) — see tableKeyGates in
 * utils/dataTable.ts. Without it the hidden table would eat the first Esc
 * (clearing a search he cannot see), take focus on '/' and tick invisible
 * rows on Cmd+A. Default false: a table outside any SplitView is visible.
 */
export const SplitListHiddenContext = createContext(false);

/** Read by DataTable (and any other list that binds keys). */
export function useSplitListHidden(): boolean {
  return useContext(SplitListHiddenContext);
}

// ─────────────────────────────────────────────────────────────────────────────
// useSplitRecord — the open record, kept in the URL
// ─────────────────────────────────────────────────────────────────────────────

export interface SplitRecord {
  /** The open record's id, or null. */
  openId: string | null;
  /** Open a record: beside the list on desktop (URL param), pushed on a phone. */
  open: (id: string) => void;
  close: () => void;
  /** True when records open beside the list (desktop web/tablet layout). */
  inPlace: boolean;
}

/**
 * `param` is the route's own record param when it has one (`rfiId`), otherwise
 * the default `rec`. `phoneHref(id)` is where a phone goes to open a record —
 * today's push destination. Without it a phone also opens in place (the
 * screen then decides what to render).
 */
export function useSplitRecord(options: { param?: string; phoneHref?: (id: string) => Href } = {}): SplitRecord {
  const { param = 'rec', phoneHref } = options;
  const { isDesktop } = useResponsiveLayout();
  const router = useRouter();
  const params = useLocalSearchParams<Record<string, string | string[]>>();
  const raw = params[param];
  const openId = typeof raw === 'string' && raw ? raw : Array.isArray(raw) && raw[0] ? raw[0] : null;
  const inPlace = isDesktop || !phoneHref;

  const open = useCallback((id: string) => {
    if (!inPlace && phoneHref) {
      router.push(phoneHref(id));
      return;
    }
    router.setParams({ [param]: id });
  }, [inPlace, phoneHref, router, param]);

  const close = useCallback(() => {
    router.setParams({ [param]: undefined });
  }, [router, param]);

  return { openId, open, close, inPlace };
}

// ─────────────────────────────────────────────────────────────────────────────
// SplitView
// ─────────────────────────────────────────────────────────────────────────────

export interface SplitViewProps {
  /** Names the saved divider position (`mageid_split_<splitId>`). */
  splitId: string;
  /** The list pane — on a phone, the ONLY thing rendered. */
  list: React.ReactNode;
  /** The open record's pane, or null when nothing is open. */
  detail: React.ReactNode | null;
  /** The open record's id (useSplitRecord().openId). Drives Esc. */
  openId: string | null;
  onClose: () => void;
  /** Shown beside the list when nothing is open (desktop split only). */
  emptyDetail?: React.ReactNode;
  backLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function SplitView(props: SplitViewProps) {
  const { isDesktop } = useResponsiveLayout();
  if (!isDesktop) return <>{props.list}</>;
  return <DesktopSplitView {...props} />;
}

function DesktopSplitView({
  splitId, list, detail, openId, onClose, emptyDetail, backLabel = 'Back to list', style, testID,
}: SplitViewProps) {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { width, onLayout } = useContainerWidth();
  const mode = splitMode(width, true);
  const [ratio, setRatio] = useState(SPLIT_LIST_DEFAULT_RATIO);
  const ratioRef = useRef(ratio);
  ratioRef.current = ratio;
  const widthRef = useRef(width);
  widthRef.current = width;
  const dragStart = useRef(ratio);

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(splitRatioKey(splitId))
      .then((raw) => { const r = parseStoredRatio(raw); if (alive && r !== null) setRatio(r); })
      .catch(() => { /* default ratio */ });
    return () => { alive = false; };
  }, [splitId]);

  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => { dragStart.current = ratioRef.current; },
    onPanResponderMove: (_e, g) => { setRatio(dragSplitRatio(dragStart.current, g.dx, widthRef.current)); },
    onPanResponderRelease: (_e, g) => {
      const r = dragSplitRatio(dragStart.current, g.dx, widthRef.current);
      setRatio(r);
      AsyncStorage.setItem(splitRatioKey(splitId), String(r)).catch(() => { /* not saved; still applied */ });
    },
  }), [splitId]);

  const hasRecord = openId !== null && detail !== null && detail !== undefined;

  // Esc only. Priority 0 (the default): a table in the list pane clears its
  // own search / selection first (priority 1). No j/k here — see the header.
  useHotkeys(
    [
      { combo: 'escape', label: 'Close the record', group: 'List', enabled: hasRecord, handler: onClose },
    ],
  );

  const single = mode === 'single';
  const listWidth = single ? 0 : splitWidths(width, ratio).listWidth;

  // ONE TREE FOR BOTH MODES. The list is ALWAYS the first child of the same
  // root View, so crossing 1100 px (he opens the 440 px AI dock on his 1512
  // MacBook, or drags the window narrower) only restyles it — it is never
  // remounted, and his search, sort, selection, cursor and scroll survive.
  // (An earlier version rendered the list under a different parent in each
  // mode, and every mode switch handed him back a reset table.) The record
  // pane is likewise always the LAST child, a View in both modes, so an open
  // record keeps its own state across the switch too.
  //
  //   split   [list (width) | divider | record or "pick a row"]   row
  //   single  [list | Back to list | record]                      column
  //           The list is display:none while a record is open (hidden, NOT
  //           unmounted: unmounting would throw away his search and scroll and
  //           take the table's j/k — which step the open record in the order
  //           he sees — with it). SplitListHiddenContext tells it so, so only
  //           j/k reach it: the first Esc closes the record, '/' and Cmd+A
  //           stay the page's.
  return (
    <View style={[single ? styles.single : styles.split, style]} onLayout={onLayout} testID={testID}>
      <View
        style={single ? [styles.pane, hasRecord && styles.hidden] : [styles.listPane, { width: listWidth }]}
        testID={testID ? `${testID}-${single ? 'single-list' : 'list'}` : undefined}
      >
        <SplitListHiddenContext.Provider value={single && hasRecord}>{list}</SplitListHiddenContext.Provider>
      </View>
      {single ? (
        hasRecord ? (
          <Pressable
            key="back"
            onPress={onClose}
            style={styles.back}
            accessibilityRole="link"
            accessibilityLabel={backLabel}
            testID={testID ? `${testID}-back` : undefined}
          >
            <ChevronLeft {...Tokens.iconSize.small} color={t.accentLabel} />
            <Text style={styles.backText}>{backLabel}</Text>
          </Pressable>
        ) : null
      ) : (
        <View
          key="divider"
          {...pan.panHandlers}
          style={[styles.divider, RESIZE_CURSOR]}
          accessibilityRole="adjustable"
          accessibilityLabel="Resize the list"
          testID={testID ? `${testID}-divider` : undefined}
        >
          <View style={styles.dividerLine} />
        </View>
      )}
      {single && !hasRecord ? null : (
        <View style={single ? styles.pane : styles.detailPane} testID={testID ? `${testID}-${single ? 'record' : 'detail'}` : undefined}>
          {hasRecord ? detail : (emptyDetail ?? (
            <View style={styles.emptyDetail}>
              <Text style={styles.emptyText}>Pick a row to open it here.</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  single: { flex: 1 },
  pane: { flex: 1 },
  hidden: { display: 'none' },
  back: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    height: Layout.control.sm,
    paddingHorizontal: 4,
    marginBottom: Layout.rowGap,
  },
  backText: { ...Type.footnoteEmphasized, color: t.accentLabel },
  split: { flex: 1, flexDirection: 'row', alignItems: 'stretch' },
  listPane: { flexGrow: 0, flexShrink: 0 },
  divider: {
    width: SPLIT_DIVIDER,
    alignItems: 'center',
    alignSelf: 'stretch',
  },
  dividerLine: { width: 1, flex: 1, backgroundColor: t.line },
  detailPane: { flex: 1, minWidth: 0 },
  emptyDetail: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Layout.gutter },
  emptyText: { ...Type.bodyCompact, color: t.textSecondary, textAlign: 'center' },
});
