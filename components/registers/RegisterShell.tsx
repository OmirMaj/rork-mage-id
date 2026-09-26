// components/registers/RegisterShell.tsx — the page every desktop register
// sits in: a title row (breadcrumbs, the screen's actions, Export CSV) over a
// DataTable, with the open record BESIDE the list in a SplitView (wave 6d,
// lane R1). The sibling of the logs' LogShell, built separately so that none
// of the four live logs or their pins move.
//
// DESKTOP WEB ONLY by construction: every screen mounts it only inside
// `isDesktopWeb ? <XRegister/> : (<>today's JSX</>)`, so the phone never
// renders this file.
//
// The open record is in the URL (the screen's own param: contactId, crewId,
// subId), so Back, refresh and a pasted link land on it. Opening another row,
// j/k (the DataTable steps in the order he SEES), Esc and "Back to list" all
// go through one guard: when any part of the open record reports unsaved
// edits (useRegisterRecordDirty), they ask "Discard changes?" first.
//
// A register creates through its toolbar New action and the page-scope 'n'
// key (onNew). It does NOT read `?new=1`: nothing in 6d produces that for a
// register (contract D6), so a reader would be dead code.

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useNavigation, type Href, type Route } from 'expo-router';
import { Download } from 'lucide-react-native';
import { Layout } from '@/constants/designTokens';
import { Type } from '@/constants/typography';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useHotkeys } from '@/hooks/useHotkeys';
import { useContainerWidth } from '@/hooks/useContainerWidth';
import { SplitView, type SplitRecord } from '@/components/desktop/SplitView';
import { ToolbarActions, type Breadcrumb, type ToolbarAction } from '@/components/desktop/ToolbarActions';
import { routeHref } from '@/components/desktop/RowLink';
import { useIsDesktop } from '@/components/ui/desktop';
import { BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import { RegisterRecordContext, createDirtyProbeSet } from '@/components/registers/RegisterRecordHost';
import { showAlert } from '@/utils/alert';
import { deliverTextFile } from '@/utils/platformFile';
import { registerCsvFileName } from '@/utils/registers/registerCsv';

/** Web only: kept off the printed page (Cmd+P prints the table, not chrome). */
const PRINT_HIDE: object = Platform.OS === 'web' ? { dataSet: { print: 'hide' } } : {};

export type RegisterId = 'contacts' | 'subs' | 'coi-vault' | 'crew' | 'leads' | 'deliveries' | 'documents';

/** Each register's own route: the fallback row href of a register with no
 *  record pane (its screen passes its own getRowHref to the table instead). */
const REGISTER_PATHNAME: Readonly<Record<RegisterId, Route>> = {
  contacts: '/contacts',
  subs: '/subs',
  'coi-vault': '/coi-vault',
  crew: '/crew',
  leads: '/leads',
  deliveries: '/deliveries',
  documents: '/documents',
};

/** The container width at which an `aside` sits beside the table. */
const ASIDE_FITS_AT = 1100;

/** What the shell hands the register's table so rows open beside it. */
export interface RegisterTableBind {
  activeKey: string | null;
  onRowOpen(id: string): void;
  getRowHref(id: string): Href;
}

export interface RegisterRecord {
  /** The screen's useSplitRecord({ param }) result. */
  split: SplitRecord;
  /** That param's name ('contactId', 'crewId', 'subId') — SplitRecord does not expose it. */
  param: string;
  /** The route the record lives on (the row's link target). */
  pathname: Route;
  /** The open record's body, or null. */
  detail: React.ReactNode | null;
  /** One record, lower case: "New contact", "New crew member". */
  noun: string;
}

export interface RegisterShellProps {
  registerId: RegisterId;
  title: string;
  leadingCrumbs?: Breadcrumb[];
  meta?: string | null;
  /** The screen's own actions; the shell appends Export CSV when `csv` is given. */
  actions: ToolbarAction[];
  /** The CSV of the rows under the current filter chip. */
  csv?: () => string;
  /** The file name's stem: `${csvStem}-YYYY-MM-DD.csv`. */
  csvStem: string;
  /** The 'n' key (page scope, never in a field) — the screen's New action. */
  onNew?: () => void;
  /** Between the title row and the table (a KPI strip, a notice). */
  above?: React.ReactNode;
  record?: RegisterRecord;
  /** A side rail: beside the table at a container >= 1100, below it otherwise. */
  aside?: React.ReactNode;
  /** Default true: give the native header back when the register unmounts
   *  (the browser narrowed below the desktop gate). */
  restoreHeaderOnExit?: boolean;
  renderTable: (bind: RegisterTableBind) => React.ReactNode;
  testID: string;
}

/** Deliver a register's CSV as a download (web) or a share sheet (native). */
export function exportRegisterCsv(stem: string, csvText: string): void {
  void deliverTextFile(registerCsvFileName(stem, new Date()), csvText, 'text/csv;charset=utf-8')
    .catch(() => showAlert('Export CSV', "Couldn't build the file. Try again."));
}

/**
 * Run `run` over a bulk selection ONE ITEM PER RENDER. The contexts' write
 * actions (deleteContact, updateCrewMember…) each rebuild the list from the
 * array they closed over, so calling one in a loop inside a single handler
 * keeps only the LAST change on the device (every server write still goes
 * out, and the next load would disagree with the screen). Here each item runs
 * after the previous one's new list has rendered, through the action of THAT
 * render.
 */
export function useOneAtATime<T>(run: (item: T) => void): (items: readonly T[]) => void {
  const runRef = useRef(run);
  runRef.current = run;
  const [queue, setQueue] = useState<readonly T[]>([]);
  useEffect(() => {
    if (queue.length === 0) return;
    runRef.current(queue[0]);
    setQueue(queue.slice(1));
  }, [queue]);
  return useCallback((items: readonly T[]) => {
    if (items.length > 0) setQueue((q) => [...q, ...items]);
  }, []);
}

export function RegisterShell({
  registerId, title, leadingCrumbs, meta, actions, csv, csvStem, onNew, above, record, aside,
  restoreHeaderOnExit = true, renderTable, testID,
}: RegisterShellProps) {
  const styles = useThemedStyles(makeStyles);
  const isDesktop = useIsDesktop();
  const navigation = useNavigation();
  const { width: bodyWidth, onLayout: onBodyLayout } = useContainerWidth();

  const split = record?.split ?? null;
  const openId = split?.openId ?? null;
  const splitRef = useRef(split);
  splitRef.current = split;

  // Every editable part of the open record registers a probe here.
  const probes = useMemo(() => createDirtyProbeSet(), []);

  const guarded = useCallback((go: () => void) => {
    if (!probes.anyDirty()) { go(); return; }
    showAlert('Discard changes?', 'This record has edits that are not saved.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: go },
    ]);
  }, [probes]);

  const guardedOpen = useCallback((id: string) => {
    const s = splitRef.current;
    if (!s || id === s.openId) return;
    guarded(() => splitRef.current?.open(id));
  }, [guarded]);

  const guardedClose = useCallback(() => {
    guarded(() => splitRef.current?.close());
  }, [guarded]);

  const recordPathname = record?.pathname;
  const recordParam = record?.param;
  const getRowHref = useCallback((id: string): Href => {
    if (recordPathname && recordParam) return routeHref(recordPathname, { [recordParam]: id });
    return routeHref(REGISTER_PATHNAME[registerId]);
  }, [recordPathname, recordParam, registerId]);

  const bind = useMemo<RegisterTableBind>(() => ({
    activeKey: openId,
    onRowOpen: guardedOpen,
    getRowHref,
  }), [openId, guardedOpen, getRowHref]);

  // 'n' for New — page scope, never while typing in a field.
  const noun = record?.noun ?? 'record';
  const onNewRef = useRef(onNew);
  onNewRef.current = onNew;
  useHotkeys(
    [{ combo: 'n', label: `New ${noun}`, group: 'This screen', blockInInput: true, handler: () => onNewRef.current?.() }],
    { enabled: !!onNew },
  );

  // Re-applied when the record closes: a record's own Stack.Screen title
  // would otherwise stay on the tab after it unmounts.
  const screenOptions = useMemo(() => ({ headerShown: false, title }), [title, openId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Narrowing the browser below the desktop gate unmounts the register and
  // mounts the phone arm, whose Stack.Screen never says headerShown: give the
  // native header back on the way out.
  useLayoutEffect(() => {
    if (!restoreHeaderOnExit) return undefined;
    return () => { navigation.setOptions({ headerShown: true }); };
  }, [navigation, restoreHeaderOnExit]);

  const exportCsv = useCallback(() => {
    if (!csv) return;
    exportRegisterCsv(csvStem, csv());
  }, [csv, csvStem]);

  const toolbarActions = useMemo<ToolbarAction[]>(() => (
    csv
      ? [...actions, { key: 'csv', label: 'Export CSV', icon: Download, onPress: exportCsv, testID: `${testID}-csv` }]
      : actions
  ), [actions, csv, exportCsv, testID]);

  const asideBeside = !!aside && bodyWidth >= ASIDE_FITS_AT;
  const listBody = aside ? (
    <View style={[styles.asideWrap, asideBeside && styles.asideRow]}>
      <View style={[styles.asideTable, asideBeside && styles.asideTableBeside]}>{renderTable(bind)}</View>
      <View style={[styles.aside, asideBeside && styles.asideBeside]} testID={`${testID}-aside`}>{aside}</View>
    </View>
  ) : renderTable(bind);

  const list = (
    <ScrollView style={styles.listScroll} contentContainerStyle={styles.listContent}>
      {listBody}
    </ScrollView>
  );

  return (
    <View style={styles.outer} testID={testID}>
      <Stack.Screen options={screenOptions} />
      <View style={[styles.page, isDesktop && styles.pageDesktop]}>
        <View style={styles.titleRow} {...PRINT_HIDE}>
          <ToolbarActions
            style={styles.toolbar}
            testID={`${testID}-actions`}
            breadcrumbs={[...(leadingCrumbs ?? []), { label: title }]}
            actions={toolbarActions}
          />
        </View>
        {meta ? <Text style={styles.meta}>{meta}</Text> : null}
        {above ? <View style={styles.above}>{above}</View> : null}
        <View style={styles.body} onLayout={onBodyLayout}>
          {record ? (
            <SplitView
              splitId={`register-${registerId}`}
              testID={`${testID}-split`}
              collapseWhenEmpty
              openId={openId}
              onClose={guardedClose}
              list={list}
              detail={openId ? (
                <RegisterRecordContext.Provider value={probes.host}>
                  <ScrollView style={styles.record} contentContainerStyle={styles.recordContent} testID={`${testID}-record`}>
                    {record.detail}
                  </ScrollView>
                </RegisterRecordContext.Provider>
              ) : null}
            />
          ) : list}
        </View>
      </View>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  outer: { flex: 1, backgroundColor: t.bg },
  page: { flex: 1 },
  pageDesktop: {
    flex: 1,
    width: '100%',
    maxWidth: Layout.page.table,
    alignSelf: 'center',
    paddingHorizontal: Layout.gutter,
    paddingTop: Layout.groupGap,
  },
  titleRow: { height: Layout.control.toolbar, flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  toolbar: { flex: 1 },
  meta: { ...Type.footnote, color: t.textSecondary, maxWidth: Layout.prose, marginBottom: Layout.rowGap },
  above: { gap: Layout.groupGap, marginBottom: Layout.groupGap },
  body: { flex: 1, minHeight: 0 },
  listScroll: { flex: 1 },
  // The web Brain FAB floats over the bottom-right corner, where register
  // rows carry their right-edge actions: the last row scrolls clear of it.
  listContent: { paddingBottom: BRAIN_FAB_CLEARANCE + Layout.gutter },
  asideWrap: { gap: Layout.gutter },
  asideRow: { flexDirection: 'row', alignItems: 'flex-start' },
  asideTable: {},
  asideTableBeside: { flex: 1, minWidth: 0 },
  aside: {},
  asideBeside: { width: Layout.register.aside },
  record: { flex: 1, minWidth: 0 },
  recordContent: { padding: Layout.cardPad, gap: Layout.groupGap },
});

export default RegisterShell;
