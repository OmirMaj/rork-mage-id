// components/logs/LogShell.tsx — the page every desktop log sits in: a title
// row (breadcrumbs, "New …", Export CSV) over a SplitView whose list is the
// log's DataTable and whose record pane is the editor (wave 6c, lane G).
//
// DESKTOP WEB ONLY. It mounts only when utils/logs/logRoutes.logRouteMode says
// 'log' or 'split', which it never does unless useIsDesktopWeb() is true — so
// the phone never renders this file.
//
// The open record is in the URL (the route's own param: rfiId, submittalId,
// coId, invoiceId), so Back, refresh and a pasted link land on it. Opening
// another row, j/k (the DataTable steps in the order he SEES) and Esc all go
// through one guard: when the open editor reports unsaved edits
// (useLogRecordDirty), they ask "Discard changes?" first.

import React, { useCallback, useMemo, useRef } from 'react';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';
import { Stack, useRouter, type Href } from 'expo-router';
import { Download, Plus } from 'lucide-react-native';
import { Layout } from '@/constants/designTokens';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useProjects } from '@/contexts/ProjectContext';
import { SplitView, useSplitRecord } from '@/components/desktop/SplitView';
import { ToolbarActions } from '@/components/desktop/ToolbarActions';
import { routeHref } from '@/components/desktop/RowLink';
import { useIsDesktop } from '@/components/ui/desktop';
import { LogRecordContext, type LogRecordHost } from '@/components/logs/LogRecordHost';
import { showAlert } from '@/utils/alert';
import { deliverTextFile } from '@/utils/platformFile';
import { LOG_NOUN, LOG_PATHNAME, RECORD_PARAM, logCsvFileName, type LogKind } from '@/utils/logs/logRoutes';

/** Web only: kept off the printed page (Cmd+P prints the record, not chrome). */
const PRINT_HIDE: object = Platform.OS === 'web' ? { dataSet: { print: 'hide' } } : {};

/** What the shell hands the log's table so rows open beside it. */
export interface LogTableBind {
  activeKey: string | null;
  onRowOpen: (id: string) => void;
  getRowHref: (id: string) => Href;
}

export interface LogShellProps {
  kind: LogKind;
  projectId: string;
  /** The editor for the open record (the screen's own form), or null. */
  detail?: React.ReactNode | null;
  /** The read-only facts strip above the editor (RecordContextStrip). */
  strip?: React.ReactNode | null;
  /** The CSV of the rows under the current filter chip. */
  csv: () => string;
  renderTable: (bind: LogTableBind) => React.ReactNode;
  testID: string;
}

export function LogShell({ kind, projectId, detail, strip, csv, renderTable, testID }: LogShellProps) {
  const router = useRouter();
  const styles = useThemedStyles(makeStyles);
  const isDesktop = useIsDesktop();
  const { getProject } = useProjects();
  const project = getProject(projectId);
  const param = RECORD_PARAM[kind];
  const pathname = LOG_PATHNAME[kind];
  const noun = LOG_NOUN[kind];
  const rec = useSplitRecord({ param });
  const openId = rec.openId;

  // The open editor's "unsaved edits?" probe (useLogRecordDirty).
  const dirtyProbe = useRef<(() => boolean) | null>(null);
  const recRef = useRef(rec);
  recRef.current = rec;

  const guarded = useCallback((go: () => void) => {
    let dirty = false;
    try { dirty = !!dirtyProbe.current?.(); } catch { dirty = false; }
    if (!dirty) { go(); return; }
    showAlert('Discard changes?', 'This record has edits that are not saved.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: go },
    ]);
  }, []);

  const guardedOpen = useCallback((id: string) => {
    if (id === recRef.current.openId) return;
    guarded(() => recRef.current.open(id));
  }, [guarded]);

  const guardedClose = useCallback(() => {
    guarded(() => recRef.current.close());
  }, [guarded]);

  const host = useMemo<LogRecordHost>(() => ({
    kind,
    close: () => recRef.current.close(),
    replaceRecord: (id: string) => recRef.current.open(id),
    setDirtyProbe: (fn) => { dirtyProbe.current = fn; },
  }), [kind]);

  const getRowHref = useCallback(
    (id: string) => routeHref(pathname, { projectId, [param]: id }),
    [pathname, projectId, param],
  );

  const exportCsv = useCallback(() => {
    void deliverTextFile(logCsvFileName(kind, project?.name, new Date()), csv(), 'text/csv;charset=utf-8')
      .catch(() => showAlert('Export CSV', "Couldn't build the file. Try again."));
  }, [kind, project?.name, csv]);

  const title = noun.many;
  // Re-applied when the record closes: the record's own Stack.Screen title
  // stays on the tab after it unmounts otherwise.
  const screenOptions = useMemo(() => ({ headerShown: false, title }), [title, openId]); // eslint-disable-line react-hooks/exhaustive-deps

  const newLabel = `New ${noun.one}`;

  return (
    <View style={styles.outer} testID={testID}>
      <Stack.Screen options={screenOptions} />
      <View style={[styles.page, isDesktop && styles.pageDesktop]}>
        <View style={styles.titleRow} {...PRINT_HIDE}>
          <ToolbarActions
            style={styles.toolbar}
            testID={`${testID}-actions`}
            breadcrumbs={[
              { label: project?.name ?? '—', href: routeHref('/project-detail', { id: projectId }) },
              { label: title },
            ]}
            actions={[
              {
                key: 'new',
                label: newLabel,
                primary: true,
                icon: Plus,
                onPress: () => router.push(routeHref(pathname, { projectId, new: '1' })),
                testID: `${testID}-new`,
              },
              { key: 'csv', label: 'Export CSV', icon: Download, onPress: exportCsv, testID: `${testID}-csv` },
            ]}
          />
        </View>
        <SplitView
          splitId={`log-${kind}`}
          testID={`${testID}-split`}
          collapseWhenEmpty
          openId={openId}
          onClose={guardedClose}
          list={(
            <ScrollView style={styles.listScroll} contentContainerStyle={styles.listContent}>
              {renderTable({ activeKey: openId, onRowOpen: guardedOpen, getRowHref })}
            </ScrollView>
          )}
          detail={openId && detail ? (
            <LogRecordContext.Provider value={host}>
              <View style={styles.record} testID={`${testID}-record`}>
                {strip}
                <View style={styles.recordBody}>{detail}</View>
              </View>
            </LogRecordContext.Provider>
          ) : null}
        />
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
    paddingTop: 16,
  },
  titleRow: { height: Layout.control.toolbar, flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  toolbar: { flex: 1 },
  listScroll: { flex: 1 },
  listContent: { paddingBottom: Layout.gutter },
  record: { flex: 1, minWidth: 0 },
  recordBody: { flex: 1, minHeight: 0 },
});

export default LogShell;
