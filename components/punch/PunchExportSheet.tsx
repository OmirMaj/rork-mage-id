// components/punch/PunchExportSheet.tsx — "Export the punch list".
//
// The founder, 2026-09-17: "make it a feature to export that punchlist please,
// allow me to export all items". The sheet defaults to EVERYTHING — every
// status, both lists (the crew list labelled INTERNAL) — and offers what is on
// screen and what is ticked as options. Two formats: a PDF report (photos with
// their markup, plan pages with numbered pins, a sign-off) and a CSV.
//
// DELIVERY RULES this component owns (the guard pins them):
//   • onPrimaryPress is SYNCHRONOUS. On web, the print tab (window.open) or the
//     CSV download (a.click) is its FIRST side effect — anything awaited before
//     it and the popup blocker eats the tab.
//   • On iOS the share sheet is presented only AFTER this Modal has finished
//     dismissing (Modal onDismiss): iOS drops a presentation made while a modal
//     is sliding away. The parked share also runs on unmount, because an
//     unmounted Modal never fires onDismiss. Android shares straight away.
//   • A failure keeps the sheet open, says what failed, and the primary button
//     retries. Closing mid-run aborts; a late native render is discarded.
//
// The numbering, scope, CSV and HTML are pure (utils/punchExportCore.ts,
// utils/punchExportHtml.ts); the platform work is utils/punchExportDelivery.ts.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { AlertTriangle, Check, FileDown, FileSpreadsheet, FileText, X } from 'lucide-react-native';
import { Colors, type ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useProjects } from '@/contexts/ProjectContext';
import { Button, cardSurface } from '@/components/ui';
import { markupForSource, sourcePhotoIdOf } from '@/components/PhotoMarkupOverlay';
import { nailIt } from '@/components/animations/NailItToast';
import { showAlert } from '@/utils/alert';
import { track, AnalyticsEvents } from '@/utils/analytics';
import type { CompanyBranding, PhotoMarkup, PunchItem, PunchItemPriority, PunchItemStatus, PunchListType } from '@/types';
import { punchListTypeOf } from '@/types';
import {
  buildPunchExportCsv,
  buildPunchExportModel,
  countPhotos,
  exportDisabledReason,
  exportFailureCopy,
  shareFailureCopy,
  exportFileName,
  exportProgressCopy,
  internalNote,
  itemsInScope,
  listChoice as computeListChoice,
  nativePhotoEstimate,
  photoNotes,
  primaryLabel,
  scopeOptions,
  PUNCH_EXPORT_NATIVE_RENDER_TIMEOUT_MS,
  type PunchExportFormat,
  type PunchExportModel,
  type PunchExportProgress,
  type PunchExportScope,
  type PunchExportScopeInput,
  type PunchExportStage,
  type PunchExportTarget,
} from '@/utils/punchExportCore';
import { buildPunchExportHtml } from '@/utils/punchExportHtml';
import {
  canShareFiles,
  csvShareOutcome,
  discardFile,
  exportAllowedOrigins,
  loadExportPref,
  nativeRenderBusy,
  openPrintWindow,
  renderNativePdf,
  resolveBrandingForExport,
  resolveExportAssets,
  saveExportPref,
  shareExportFile,
  startWebDownload,
  writeNativeCsv,
  type PrintWindowHandle,
} from '@/utils/punchExportDelivery';

// ───────────────────────────────────────────────────────────────────────────
// Header button
// ───────────────────────────────────────────────────────────────────────────

export function PunchExportHeaderButton({ onPress }: { onPress: () => void }) {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <TouchableOpacity
      onPress={onPress}
      style={styles.headerBtn}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel="Export the punch list"
      accessibilityHint="PDF report or spreadsheet"
      testID="punch-export-open"
    >
      <FileDown size={18} color={t.accent} strokeWidth={1.75} />
      <Text style={styles.headerBtnText}>Export</Text>
    </TouchableOpacity>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// The sheet
// ───────────────────────────────────────────────────────────────────────────

export interface PunchExportSheetProps {
  visible: boolean;
  onClose: () => void;
  projectId: string;
  /** EVERY item on the project — both lists, unfiltered. */
  allItems: PunchItem[];
  filteredItems: PunchItem[];
  selectedIds: string[];
  activeList: PunchListType;
  filterStatus: PunchItemStatus | 'all';
  filterSub: string;
  filterPriority: PunchItemPriority | 'all';
  filterLocationKey: string;
  filterLocationLabel: string;
}

type Phase =
  | { kind: 'idle' }
  | ({ kind: 'running' } & PunchExportProgress)
  | { kind: 'blocked'; html: string; fileName: string; remoteCount: number; reason: 'blocked' | 'closed'; model: PunchExportModel; photoCount: number }
  | { kind: 'error'; title: string; body: string };

type BlockedPhase = Extract<Phase, { kind: 'blocked' }>;

const BLANK_BRANDING: CompanyBranding = {
  companyName: '', contactName: '', email: '', phone: '', address: '', licenseNumber: '', tagline: '',
};

function stageOf(err: unknown): PunchExportStage {
  const s = (err as { stage?: unknown } | null)?.stage;
  return typeof s === 'string' ? (s as PunchExportStage) : 'render';
}

function causeOf(err: unknown): unknown {
  const c = (err as { cause?: unknown } | null)?.cause;
  return c ?? err;
}

export function PunchExportSheet(props: PunchExportSheetProps) {
  const {
    visible, onClose, projectId, allItems, filteredItems, selectedIds, activeList,
    filterStatus, filterSub, filterPriority, filterLocationKey, filterLocationLabel,
  } = props;
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { getProject, settings, projectPhotos, getPlanSheetsForProject } = useProjects();

  const target: PunchExportTarget = Platform.OS === 'web' ? 'web' : Platform.OS === 'android' ? 'android' : 'ios';
  const project = getProject(projectId);
  const projectName = project?.name ?? 'Project';
  const rawBranding: CompanyBranding = settings.branding ?? BLANK_BRANDING;

  // ── State ─────────────────────────────────────────────────────────────
  const [scope, setScope] = useState<PunchExportScope>('all');
  const [includeCrew, setIncludeCrew] = useState(true);
  const [format, setFormat] = useState<PunchExportFormat>('pdf');
  const [photos, setPhotos] = useState(true);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });

  const busyRef = useRef(false);
  const runIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const pendingShareRef = useRef<(() => void) | null>(null);
  const printHandleRef = useRef<PrintWindowHandle | null>(null);
  const prefTouchedRef = useRef(false);

  // Scope and crew reset on every open and are never remembered; format and
  // photos come back from the last export on this device.
  useEffect(() => {
    if (!visible) return;
    setScope('all');
    setIncludeCrew(true);
    setPhase({ kind: 'idle' });
    prefTouchedRef.current = false;
    let alive = true;
    void loadExportPref().then(p => {
      if (!alive || !p || prefTouchedRef.current) return;
      setFormat(p.format);
      setPhotos(p.photos);
    });
    return () => { alive = false; };
  }, [visible]);

  // An unmounted Modal never fires onDismiss, so a parked share runs here.
  useEffect(() => () => {
    const parked = pendingShareRef.current;
    pendingShareRef.current = null;
    if (parked) parked();
  }, []);

  // ── Derived ───────────────────────────────────────────────────────────
  const scopeInput: PunchExportScopeInput = useMemo(() => ({
    allItems,
    filteredItems,
    selectedIds,
    activeList,
    filters: {
      status: filterStatus,
      sub: filterSub,
      priority: filterPriority,
      locationKey: filterLocationKey,
      locationLabel: filterLocationLabel,
    },
  }), [allItems, filteredItems, selectedIds, activeList, filterStatus, filterSub, filterPriority, filterLocationKey, filterLocationLabel]);

  const listChoice = useMemo(() => computeListChoice(allItems), [allItems]);
  // With only one list on the project there is nothing to leave out.
  const crewOn = listChoice.available ? includeCrew : true;
  const options = useMemo(() => scopeOptions(scopeInput, crewOn), [scopeInput, crewOn]);
  const effScope: PunchExportScope = options.some(o => o.scope === scope) ? scope : 'all';
  const inScope = useMemo(() => itemsInScope(scopeInput, effScope, crewOn), [scopeInput, effScope, crewOn]);
  const photoCount = useMemo(() => countPhotos(inScope), [inScope]);
  const hasCrewInScope = useMemo(() => inScope.some(i => punchListTypeOf(i) === 'crew'), [inScope]);
  const estimate = useMemo(() => nativePhotoEstimate({ photoCount, target }), [photoCount, target]);
  const notes = useMemo(
    () => photoNotes({ target, format, includePhotos: photos, photoCount }),
    [target, format, photos, photoCount],
  );
  const disabledReason = exportDisabledReason({ projectItemCount: allItems.length, scope: effScope, count: inScope.length });
  const running = phase.kind === 'running';
  const blocked = phase.kind === 'blocked';
  const primary = primaryLabel({
    format,
    target,
    blocked,
    approxBytes: format === 'pdf' && photos && target !== 'web' && photoCount > 0 ? estimate.approxBytes : null,
  });
  const crewWarning = internalNote(hasCrewInScope);

  const markupByItemId = useMemo(() => {
    const out = new Map<string, readonly PhotoMarkup[]>();
    if (!visible) return out;
    for (const item of allItems) {
      const m = markupForSource(projectPhotos, sourcePhotoIdOf(item), item.photoUri);
      if (m.length > 0) out.set(item.id, m);
    }
    return out;
  }, [visible, allItems, projectPhotos]);

  // ── Option changes ────────────────────────────────────────────────────
  const tick = useCallback(() => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync().catch(() => {});
  }, []);
  const clearError = useCallback(() => {
    setPhase(p => (p.kind === 'error' || p.kind === 'blocked' ? { kind: 'idle' } : p));
  }, []);
  const pickScope = useCallback((s: PunchExportScope) => { tick(); setScope(s); clearError(); }, [tick, clearError]);
  const toggleCrew = useCallback(() => { tick(); setIncludeCrew(v => !v); clearError(); }, [tick, clearError]);
  const pickFormat = useCallback((f: PunchExportFormat) => {
    tick();
    prefTouchedRef.current = true;
    setFormat(f);
    clearError();
    void saveExportPref({ format: f, photos });
  }, [tick, clearError, photos]);
  const togglePhotos = useCallback(() => {
    tick();
    prefTouchedRef.current = true;
    const next = !photos;
    setPhotos(next);
    clearError();
    void saveExportPref({ format, photos: next });
  }, [tick, clearError, photos, format]);

  // ── Finishing ─────────────────────────────────────────────────────────
  const trackDone = useCallback((model: PunchExportModel, fmt: PunchExportFormat, includedPhotos: number) => {
    track(AnalyticsEvents.PDF_GENERATED, {
      doc: 'punch_list',
      format: fmt,
      scope: model.scope,
      crew: model.hasCrew,
      items: model.totalCount,
      photos: includedPhotos,
      target: model.target,
    });
  }, []);

  const handOver = useCallback((uri: string, kind: 'pdf' | 'csv') => {
    // The sheet is gone by the time the share sheet fails, so the failure is
    // told in an alert rather than in the (closed) sheet.
    const share = () => {
      void shareExportFile(uri, kind, `Punch list — ${projectName}`).then(res => {
        if (res.ok) return;
        const copy = shareFailureCopy(kind);
        showAlert(copy.title, copy.body);
      });
    };
    if (Platform.OS !== 'web') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }
    busyRef.current = false;
    setPhase({ kind: 'idle' });
    if (Platform.OS === 'ios') {
      // Presented from Modal onDismiss — iOS drops a share sheet presented
      // while this modal is still sliding away.
      pendingShareRef.current = share;
      onClose();
    } else {
      onClose();
      share();
    }
  }, [projectName, onClose]);

  const fail = useCallback((stage: PunchExportStage, err?: unknown) => {
    busyRef.current = false;
    const copy = exportFailureCopy(stage, err);
    setPhase({ kind: 'error', title: copy.title, body: copy.body });
    return copy;
  }, []);

  // ── Runs ──────────────────────────────────────────────────────────────
  const runNativePdf = useCallback(async (id: number, model: PunchExportModel, includePhotos: boolean) => {
    const signal = abortRef.current?.signal;
    try {
      const [assets, branding] = await Promise.all([
        resolveExportAssets(model, {
          includePhotos,
          target,
          signal,
          onProgress: p => { if (id === runIdRef.current) setPhase({ kind: 'running', ...p }); },
        }),
        resolveBrandingForExport(rawBranding, target),
      ]);
      if (id !== runIdRef.current) return;
      const html = buildPunchExportHtml(model, assets, { includePhotos, branding, target, allowedOrigins: exportAllowedOrigins() });
      setPhase({ kind: 'running', step: 'building', done: 0, total: 1, photoCount: assets.includedPhotoCount, approxBytes: assets.approxBytes });
      const { uri } = await renderNativePdf(
        html,
        exportFileName({ projectName: model.projectName, scope: model.scope, hasCrew: model.hasCrew, format: 'pdf', now: new Date(model.generatedAtIso) }),
        { timeoutMs: PUNCH_EXPORT_NATIVE_RENDER_TIMEOUT_MS },
      );
      if (id !== runIdRef.current) { void discardFile(uri); return; }
      trackDone(model, 'pdf', assets.includedPhotoCount);
      handOver(uri, 'pdf');
    } catch (err) {
      if (id !== runIdRef.current) return;
      fail(stageOf(err), causeOf(err));
    }
  }, [target, rawBranding, trackDone, handOver, fail]);

  const runNativeCsv = useCallback(async (id: number, model: PunchExportModel, fileName: string, csv: string) => {
    try {
      const shareable = await canShareFiles();
      const uri = await writeNativeCsv(fileName, csv);
      if (id !== runIdRef.current) return;
      if (csvShareOutcome(uri, shareable) !== 'shared' || !uri) {
        fail('share-unavailable');
        return;
      }
      trackDone(model, 'csv', 0);
      handOver(uri, 'csv');
    } catch (err) {
      if (id !== runIdRef.current) return;
      fail(stageOf(err) === 'render' ? 'write' : stageOf(err), causeOf(err));
    }
  }, [trackDone, handOver, fail]);

  const finishWeb = useCallback((
    id: number,
    outcome: 'printed' | 'printed-early' | 'closed',
    blockedState: Omit<BlockedPhase, 'reason' | 'kind'>,
  ) => {
    if (id !== runIdRef.current) return;
    busyRef.current = false;
    if (outcome === 'closed') {
      setPhase({ kind: 'blocked', reason: 'closed', ...blockedState });
      return;
    }
    printHandleRef.current = null;
    trackDone(blockedState.model, 'pdf', blockedState.photoCount);
    setPhase({ kind: 'idle' });
    onClose();
    nailIt('The report is open in a new tab — print it or save it as a PDF from there.');
  }, [trackDone, onClose]);

  const runWebPdf = useCallback(async (id: number, handle: PrintWindowHandle, model: PunchExportModel, includePhotos: boolean) => {
    const signal = abortRef.current?.signal;
    handle.setStatus('Preparing your punch list…');
    try {
      const [assets, branding] = await Promise.all([
        resolveExportAssets(model, {
          includePhotos,
          target: 'web',
          signal,
          onProgress: p => {
            if (id !== runIdRef.current) return;
            setPhase({ kind: 'running', ...p });
            handle.setStatus(exportProgressCopy(p, 'web'));
          },
        }),
        resolveBrandingForExport(rawBranding, 'web'),
      ]);
      if (id !== runIdRef.current) { handle.close(); return; }
      const html = buildPunchExportHtml(model, assets, { includePhotos, branding, target: 'web', allowedOrigins: exportAllowedOrigins() });
      const fileName = exportFileName({ projectName: model.projectName, scope: model.scope, hasCrew: model.hasCrew, format: 'html', now: new Date(model.generatedAtIso) });
      const blockedState = { html, fileName, remoteCount: assets.remoteCount, model, photoCount: assets.includedPhotoCount };
      if (handle.blocked || handle.isClosed()) {
        busyRef.current = false;
        setPhase({ kind: 'blocked', reason: handle.blocked ? 'blocked' : 'closed', ...blockedState });
        return;
      }
      setPhase({ kind: 'running', step: 'opening', done: 0, total: 1 });
      const outcome = await handle.writeAndPrint(html, { remoteCount: assets.remoteCount });
      finishWeb(id, outcome, blockedState);
    } catch (err) {
      if (id !== runIdRef.current) return;
      const copy = fail(stageOf(err), causeOf(err));
      handle.setStatus(copy.title);
    }
  }, [rawBranding, fail, finishWeb]);

  const reopenBlocked = useCallback((state: BlockedPhase) => {
    const h = openPrintWindow();
    if (h.blocked) {
      startWebDownload(state.fileName, state.html, 'text/html;charset=utf-8');
      fail('popup-blocked-twice');
      return;
    }
    busyRef.current = true;
    const id = ++runIdRef.current;
    printHandleRef.current = h;
    setPhase({ kind: 'running', step: 'opening', done: 0, total: 1 });
    const rest = { html: state.html, fileName: state.fileName, remoteCount: state.remoteCount, model: state.model, photoCount: state.photoCount };
    void h.writeAndPrint(state.html, { remoteCount: state.remoteCount })
      .then(outcome => finishWeb(id, outcome, rest))
      .catch(err => { if (id === runIdRef.current) fail('render', err); });
  }, [fail, finishWeb]);

  // SYNCHRONOUS on purpose — see the header. No await, no async.
  const onPrimaryPress = useCallback(() => {
    if (busyRef.current || disabledReason) return;
    if (phase.kind === 'blocked') return reopenBlocked(phase);
    if (format === 'pdf' && target !== 'web' && nativeRenderBusy()) {
      const copy = exportFailureCopy('busy');
      setPhase({ kind: 'error', title: copy.title, body: copy.body });
      return;
    }
    const now = new Date();
    // Everything below up to the hand-off is synchronous; a throw on bad data
    // must still land in the sheet (and close a print tab already opened).
    try {
    const model = buildPunchExportModel({
      scopeInput,
      scope: effScope,
      includeCrew: crewOn,
      target,
      project: { id: projectId, name: projectName, location: project?.location },
      sheets: getPlanSheetsForProject(projectId),
      markupByItemId,
      now,
    });
    busyRef.current = true;
    const id = ++runIdRef.current;
    abortRef.current = new AbortController();

    if (format === 'csv') {
      const csv = buildPunchExportCsv(model);
      const fileName = exportFileName({ projectName: model.projectName, scope: model.scope, hasCrew: model.hasCrew, format: 'csv', now });
      if (target === 'web') {
        startWebDownload(fileName, csv, 'text/csv;charset=utf-8');
        trackDone(model, 'csv', 0);
        busyRef.current = false;
        onClose();
        nailIt(`Downloaded ${fileName}`);
        return;
      }
      setPhase({ kind: 'running', step: 'building', done: 0, total: 1 });
      void runNativeCsv(id, model, fileName, csv);
      return;
    }

    if (target === 'web') {
      const handle = openPrintWindow();
      printHandleRef.current = handle;
      setPhase({ kind: 'running', step: 'signing', done: 0, total: 0 });
      void runWebPdf(id, handle, model, photos);
      return;
    }

    setPhase({ kind: 'running', step: 'signing', done: 0, total: 0 });
    void runNativePdf(id, model, photos);
    } catch (e) {
      runIdRef.current++;
      abortRef.current?.abort();
      try { printHandleRef.current?.close(); } catch {/* already gone */}
      printHandleRef.current = null;
      fail('render', e);
    }
  }, [
    disabledReason, phase, reopenBlocked, format, target, scopeInput, effScope, crewOn, projectId, projectName,
    project?.location, getPlanSheetsForProject, markupByItemId, trackDone, onClose, runNativeCsv, runWebPdf,
    runNativePdf, photos, fail,
  ]);

  const handleClose = useCallback(() => {
    abortRef.current?.abort();
    runIdRef.current++;
    const wasRunning = busyRef.current;
    busyRef.current = false;
    if (wasRunning && target === 'web') printHandleRef.current?.close();
    printHandleRef.current = null;
    setPhase({ kind: 'idle' });
    onClose();
  }, [target, onClose]);

  const handleDismissed = useCallback(() => {
    const next = pendingShareRef.current;
    pendingShareRef.current = null;
    next?.();
  }, []);

  // ── Render ────────────────────────────────────────────────────────────
  const showCrewToggle = effScope === 'all' && listChoice.available;
  const progress = phase.kind === 'running' ? phase : null;
  const determinate = progress && (progress.step === 'photos' || progress.step === 'plans') && progress.total > 0;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose} onDismiss={handleDismissed}>
      <View style={styles.overlay}>
        <View style={[styles.card, { paddingBottom: insets.bottom + 16 }]}>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <View style={styles.headerRow}>
              <View style={styles.headerText}>
                <Text style={styles.title}>Export punch list</Text>
                <Text style={styles.subtitle} numberOfLines={1}>{projectName}</Text>
              </View>
              <TouchableOpacity
                onPress={handleClose}
                hitSlop={10}
                style={styles.closeBtn}
                accessibilityRole="button"
                accessibilityLabel="Close"
                testID="punch-export-close"
              >
                <X size={20} color={t.textSecondary} strokeWidth={1.75} />
              </TouchableOpacity>
            </View>

            <Text style={styles.sectionLabel}>WHAT TO EXPORT</Text>
            <View accessibilityRole="radiogroup">
              {options.map(o => {
                const checked = o.scope === effScope;
                const optDisabled = running;
                return (
                  <TouchableOpacity
                    key={o.scope}
                    onPress={() => pickScope(o.scope)}
                    disabled={optDisabled}
                    style={[styles.optionRow, checked && styles.optionRowOn]}
                    accessibilityRole="radio"
                    accessibilityState={{ checked, disabled: optDisabled }}
                    accessibilityLabel={`${o.label}. ${o.detail}`}
                    testID={`punch-export-scope-${o.scope}`}
                  >
                    <View style={[styles.radio, checked && styles.radioOn]}>
                      {checked ? <View style={styles.radioDot} /> : null}
                    </View>
                    <View style={styles.optionText}>
                      <Text style={styles.optionLabel}>{o.label}</Text>
                      <Text style={styles.optionDetail}>{o.detail}</Text>
                      {o.disabledReason ? <Text style={styles.optionReason}>{o.disabledReason}</Text> : null}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>

            {showCrewToggle ? (
              <TouchableOpacity
                onPress={toggleCrew}
                disabled={running}
                style={styles.checkRow}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: includeCrew, disabled: running }}
                accessibilityLabel="Include the crew list (internal)"
                testID="punch-export-crew"
              >
                <View style={[styles.checkbox, includeCrew && styles.checkboxOn]}>
                  {includeCrew ? <Check size={14} color={t.accentLabel} strokeWidth={2.5} /> : null}
                </View>
                <View style={styles.optionText}>
                  <Text style={styles.optionLabel}>Include the crew list (internal)</Text>
                  <Text style={styles.optionDetail}>
                    Marked INTERNAL in the PDF and the file name. Turn it off for a copy you send to the owner or client.
                  </Text>
                </View>
              </TouchableOpacity>
            ) : null}

            <Text style={styles.sectionLabel}>FORMAT</Text>
            <View style={styles.chipRow}>
              {([
                { f: 'pdf' as const, label: 'PDF report', Icon: FileText },
                { f: 'csv' as const, label: 'Spreadsheet (CSV)', Icon: FileSpreadsheet },
              ]).map(({ f, label, Icon }) => {
                const on = format === f;
                return (
                  <TouchableOpacity
                    key={f}
                    onPress={() => pickFormat(f)}
                    disabled={running}
                    style={[styles.chip, on && styles.chipOn]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on, disabled: running }}
                    accessibilityLabel={label}
                    testID={`punch-export-format-${f}`}
                  >
                    <Icon size={15} color={on ? t.accentLabel : t.textSecondary} strokeWidth={1.75} />
                    <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {format === 'csv' ? (
              <Text style={styles.note}>
                One row per item with every field — dates as YYYY-MM-DD. Opens in Excel, Numbers or Google Sheets. A cell that starts with = + - or @ gets a leading apostrophe so a spreadsheet will not run it as a formula.
              </Text>
            ) : null}

            {format === 'pdf' ? (
              <>
                <Text style={styles.sectionLabel}>PHOTOS</Text>
                <TouchableOpacity
                  onPress={togglePhotos}
                  disabled={running}
                  style={styles.checkRow}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: photos, disabled: running }}
                  accessibilityLabel={`Include photos, ${photoCount} photo${photoCount === 1 ? '' : 's'}`}
                  testID="punch-export-photos"
                >
                  <View style={[styles.checkbox, photos && styles.checkboxOn]}>
                    {photos ? <Check size={14} color={t.accentLabel} strokeWidth={2.5} /> : null}
                  </View>
                  <Text style={[styles.optionLabel, styles.flex1]}>Include photos</Text>
                  <Text style={styles.optionDetail}>{photoCount} photo{photoCount === 1 ? '' : 's'}</Text>
                </TouchableOpacity>
                {notes.map(n => <Text key={n} style={styles.note}>{n}</Text>)}
              </>
            ) : null}

            <View style={styles.status} accessibilityLiveRegion="polite">
              {progress ? (
                <>
                  <View style={styles.statusRow}>
                    <ActivityIndicator size="small" color={t.accent} />
                    <Text style={styles.statusText}>{exportProgressCopy(progress, target)}</Text>
                  </View>
                  {determinate ? (
                    <View
                      style={styles.bar}
                      accessibilityRole="progressbar"
                      accessibilityValue={{ min: 0, max: progress.total, now: progress.done }}
                      accessibilityLiveRegion="polite"
                    >
                      <View style={[styles.barFill, { width: `${Math.round((progress.done / progress.total) * 100)}%` }]} />
                    </View>
                  ) : null}
                </>
              ) : null}
              {phase.kind === 'blocked' ? (
                <Text style={styles.statusText}>
                  {phase.reason === 'blocked'
                    ? 'Your browser blocked the new tab — tap Open PDF to show it.'
                    : 'The print tab was closed before the PDF was ready — tap Open PDF.'}
                </Text>
              ) : null}
              {phase.kind === 'error' ? (
                <>
                  <Text style={styles.errorTitle}>{phase.title}</Text>
                  <Text style={styles.errorBody}>{phase.body}</Text>
                </>
              ) : null}
              {phase.kind === 'idle' && disabledReason ? (
                <Text style={styles.statusText}>{disabledReason}</Text>
              ) : null}
            </View>

            {crewWarning ? (
              <View style={styles.warnRow}>
                <AlertTriangle size={14} color={t.warningLabel} strokeWidth={2} />
                <Text style={styles.warnText}>{crewWarning}</Text>
              </View>
            ) : null}

            <View style={styles.buttons}>
              <Button
                label={primary}
                onPress={onPrimaryPress}
                loading={running}
                disabled={!!disabledReason || running}
                iconLeft={format === 'csv'
                  ? <FileSpreadsheet size={18} color={t.accentLabel} strokeWidth={1.75} />
                  : <FileDown size={18} color={t.accentLabel} strokeWidth={1.75} />}
                fullWidth
                size="lg"
                testID="punch-export-primary"
              />
              <Button
                label={running ? 'Stop' : 'Cancel'}
                onPress={handleClose}
                variant="ghost"
                fullWidth
                testID="punch-export-cancel"
              />
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  headerBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, padding: 6 },
  headerBtnText: { color: t.accentLabel, fontSize: Type.subhead.fontSize, fontWeight: '600' },

  overlay: { flex: 1, backgroundColor: Colors.overlay, justifyContent: 'flex-end' },
  card: {
    ...cardSurface(t, { radius: 'panel', pad: 20, bordered: false }),
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center',
    maxHeight: '88%',
  },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 },
  headerText: { flex: 1, paddingRight: 12 },
  title: { ...Type.title3, fontWeight: '700', color: t.text },
  subtitle: { ...Type.footnote, color: t.textSecondary, marginTop: 2 },
  closeBtn: { padding: 4 },

  sectionLabel: {
    ...Type.caption2,
    fontWeight: '700',
    letterSpacing: 0.8,
    color: t.textSecondary,
    marginTop: Tokens.spacing.md,
    marginBottom: 8,
  },
  optionRow: {
    ...cardSurface(t, { radius: 'card', pad: 12 }),
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 8,
  },
  optionRowOn: { backgroundColor: t.accentSoft, borderColor: t.accent },
  radio: {
    width: 20, height: 20, borderRadius: Tokens.radius.full, borderWidth: 1.5, borderColor: t.textMuted,
    alignItems: 'center', justifyContent: 'center', marginTop: 1,
  },
  radioOn: { borderColor: t.accent },
  radioDot: { width: 10, height: 10, borderRadius: Tokens.radius.full, backgroundColor: t.accent },
  optionText: { flex: 1 },
  optionLabel: { ...Type.subhead, fontWeight: '600', color: t.text },
  optionDetail: { ...Type.caption1, color: t.textSecondary, marginTop: 2 },
  optionReason: { ...Type.caption1, color: t.dangerLabel, marginTop: 4 },
  flex1: { flex: 1 },

  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  checkbox: {
    width: 22, height: 22, borderRadius: Tokens.radius.xs, borderWidth: 1.5, borderColor: t.textMuted,
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxOn: { borderColor: t.accent, backgroundColor: t.accentSoft },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 9,
    borderRadius: Tokens.radius.full,
    backgroundColor: t.surfaceAlt,
    borderWidth: 0.5,
    borderColor: t.line,
  },
  chipOn: { backgroundColor: t.accentSoft, borderColor: t.accent },
  chipText: { ...Type.footnote, fontWeight: '600', color: t.textSecondary },
  chipTextOn: { color: t.accentLabel },
  note: { ...Type.caption1, color: t.textSecondary, marginTop: 8 },

  status: { marginTop: Tokens.spacing.md, minHeight: 4 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  statusText: { ...Type.footnote, color: t.textSecondary, flex: 1 },
  bar: { height: 4, borderRadius: Tokens.radius.full, backgroundColor: t.surfaceAlt, marginTop: 10, overflow: 'hidden' },
  barFill: { height: 4, backgroundColor: t.accent },
  errorTitle: { ...Type.subhead, fontWeight: '700', color: t.dangerLabel },
  errorBody: { ...Type.footnote, color: t.text, marginTop: 4 },

  warnRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: Tokens.spacing.md },
  warnText: { ...Type.caption1, color: t.warningLabel, flex: 1 },

  buttons: { marginTop: Tokens.spacing.md, gap: 8 },
});

export default PunchExportSheet;
