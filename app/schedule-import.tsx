// schedule-import.tsx — bring an external construction schedule into MAGE's
// Schedule Pro. Two source formats:
//
//   • Excel (.xlsx)      — parsed server-side (SheetJS) in the `import-schedule`
//                          edge fn, which asks Gemini to map the header row to
//                          MAGE's schedule fields. We show the detected mapping
//                          + a live preview so the user confirms before import.
//   • MS Project (.xml)  — MSPDI, parsed deterministically server-side (no AI,
//                          fully auto-mapped).
//
// Pipeline once the edge fn returns normalized ImportedScheduleRow[]:
//   mapRowsToScheduleTasks (PURE)  →  runCpm (validate: cycles/anchor conflicts)
//   →  captureBaseline of the CURRENT tasks ("Before import — …")
//   →  updateProject (persists via the offline queue).
//
// Pro-tier gated client-side (useTierAccess) AND server-side (requireTier in the
// edge fn) — never trust the client gate alone.

import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Haptics from 'expo-haptics';
import {
  FileInput, Upload, FileSpreadsheet, FileCode2, CheckCircle2, AlertTriangle,
  Info, ChevronLeft, ArrowRight, Lock, ListChecks, CalendarClock,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useProjects } from '@/contexts/ProjectContext';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useTierAccess } from '@/hooks/useTierAccess';
import { mapRowsToScheduleTasks } from '@/utils/scheduleImport';
import { runCpm } from '@/utils/cpm';
import { captureBaseline } from '@/utils/scheduleOps';
import { buildScheduleFromTasks } from '@/utils/scheduleEngine';
import { nailIt, oops } from '@/components/animations/NailItToast';
import { showAlert } from '@/utils/alert';
import type {
  ScheduleImportResult, ScheduleImportField, ProjectResource, ProjectSchedule, ScheduleScenario,
} from '@/types';

// Fields we surface in the "detected columns" summary, in display order.
const FIELD_LABELS: { key: ScheduleImportField; label: string }[] = [
  { key: 'title', label: 'Task name' },
  { key: 'durationDays', label: 'Duration' },
  { key: 'startDate', label: 'Start' },
  { key: 'finishDate', label: 'Finish' },
  { key: 'predecessors', label: 'Predecessors' },
  { key: 'progress', label: '% complete' },
  { key: 'wbs', label: 'WBS' },
  { key: 'outlineLevel', label: 'Outline level' },
  { key: 'resource', label: 'Resource' },
  { key: 'notes', label: 'Notes' },
];

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

// Web-safe base64 (no Buffer). Native uses FileSystem's base64 encoding.
function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return typeof btoa === 'function' ? btoa(binary) : '';
}

export default function ScheduleImportScreen() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { projectId } = useLocalSearchParams<{ projectId?: string }>();
  const { projects, updateProject } = useProjects();
  const { canAccess } = useTierAccess();

  const allowed = canAccess('schedule_import');

  const project = useMemo(
    () => projects.find(p => p.id === projectId) ?? null,
    [projects, projectId],
  );

  const [busy, setBusy] = useState<boolean>(false);
  const [importing, setImporting] = useState<boolean>(false);
  const [fileName, setFileName] = useState<string>('');
  const [result, setResult] = useState<ScheduleImportResult | null>(null);

  const previewRows = useMemo(() => (result?.rows ?? []).slice(0, 15), [result]);
  const importableCount = useMemo(
    () => (result?.rows ?? []).filter(r => (r.title ?? '').trim().length > 0).length,
    [result],
  );

  // For Excel: which detected fields mapped to a real column (for the summary).
  const detectedColumns = useMemo(() => {
    if (!result || result.format !== 'xlsx' || !result.mapping || !result.rawColumns) return [];
    return FIELD_LABELS
      .map(({ key, label }) => {
        const idx = result.mapping?.[key];
        const col = idx != null && idx >= 0 ? result.rawColumns?.[idx] : undefined;
        return col ? { label, col } : null;
      })
      .filter((x): x is { label: string; col: string } => x !== null);
  }, [result]);

  const pickFile = useCallback(async () => {
    try {
      setBusy(true);
      setResult(null);
      const picked = await DocumentPicker.getDocumentAsync({
        type: [
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'text/xml',
          'application/xml',
        ],
        copyToCacheDirectory: true,
      });
      if (picked.canceled || !picked.assets?.length) return;
      const asset = picked.assets[0];
      const name = asset.name ?? 'schedule';
      const lower = name.toLowerCase();
      const isXlsx = lower.endsWith('.xlsx');
      const isXml = lower.endsWith('.xml');
      if (!isXlsx && !isXml) {
        showAlert('Unsupported file', 'Pick an Excel (.xlsx) or MS Project (.xml) schedule.');
        return;
      }
      setFileName(name);

      // Read: xlsx as base64, xml as UTF-8. Web can't use FileSystem, so fetch.
      const body: { fileBase64?: string; fileText?: string; filename: string } = { filename: name };
      if (Platform.OS === 'web') {
        const res = await fetch(asset.uri);
        if (isXlsx) body.fileBase64 = arrayBufferToBase64(await res.arrayBuffer());
        else body.fileText = await res.text();
      } else if (isXlsx) {
        body.fileBase64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: 'base64' });
      } else {
        body.fileText = await FileSystem.readAsStringAsync(asset.uri, { encoding: 'utf8' });
      }

      const { data, error } = await supabase.functions.invoke<ScheduleImportResult>(
        'import-schedule',
        { body },
      );
      if (error) throw new Error(error.message);
      const failed = data as unknown as { success?: boolean; error?: string } | null;
      if (failed?.success === false) throw new Error(failed.error ?? 'Import failed.');
      if (!data || !Array.isArray(data.rows)) throw new Error('The importer returned no rows.');
      setResult(data);
      if (Platform.OS !== 'web') void Haptics.selectionAsync();
    } catch (err) {
      console.error('[ScheduleImport] pick/parse failed', err);
      showAlert('Could not read that schedule', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }, []);

  const persist = useCallback((
    proj: NonNullable<typeof project>,
    mappedTasks: ReturnType<typeof mapRowsToScheduleTasks>['tasks'],
    projectFinish: number,
    scheduleStartDate: string,
  ) => {
    const existing = proj.schedule;

    // Recoverable pre-import backup. Two things happen before we overwrite:
    //
    //  1. A full-fidelity scenario snapshot (`Before import — <date>`) holding
    //     complete ScheduleTask objects (titles, durations, dependencies,
    //     progress, crew, constraints, …). This is the ACTUAL restore path —
    //     the user can one-tap "Restore" it from What-If Scenarios, which
    //     copies these tasks back into schedule.tasks. A ScheduleBaseline only
    //     snapshots {id,startDay,endDay}, so it could never rebuild the plan.
    //  2. A variance baseline (unchanged) so slip/variance display still works.
    const existingScenarios = [...((existing?.scenarios ?? []))];
    if (existing?.tasks?.length) {
      const backupScenario: ScheduleScenario = {
        id: `scn-import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: `Before import — ${new Date().toLocaleDateString()}`,
        note: 'Auto-saved before a schedule import replaced the plan. Tap Restore to bring it back.',
        createdAt: new Date().toISOString(),
        // Deep-clone tasks + their nested link arrays so the backup is immune
        // to any later mutation of the live schedule.
        tasks: existing.tasks.map(t => ({
          ...t,
          dependencies: t.dependencies ? [...t.dependencies] : t.dependencies,
          dependencyLinks: t.dependencyLinks ? t.dependencyLinks.map(l => ({ ...l })) : t.dependencyLinks,
          resourceIds: t.resourceIds ? [...t.resourceIds] : t.resourceIds,
        })),
      };
      existingScenarios.push(backupScenario);
    }

    // Variance baseline (compact {id,startDay,endDay}) — kept alongside the
    // full scenario backup so slip/variance display still works.
    const baselines = [...((existing?.baselines ?? []))];
    if (existing?.tasks?.length) {
      const snap = captureBaseline(
        existing.tasks,
        `Before import — ${new Date().toLocaleDateString()}`,
        'Auto-captured before a schedule import replaced the plan.',
        { reasonCode: 'other' },
      );
      baselines.push(snap as unknown as NonNullable<ProjectSchedule['baselines']>[number]);
    }

    // Merge resources: keep existing, append any new crew names from the import.
    const existingResources = existing?.resources ?? [];
    const known = new Set(existingResources.map(r => r.name.trim().toLowerCase()));
    const newResources: ProjectResource[] = Array.from(
      new Set(mappedTasks.map(t => (t.crew ?? '').trim()).filter(Boolean)),
    )
      .filter(n => !known.has(n.toLowerCase()))
      .map((n, i) => ({ id: `res-import-${Date.now()}-${i}`, name: n }));
    const mergedResources = [...existingResources, ...newResources];

    // Base schedule: reuse the existing one (keeps calendar/settings) or mint a
    // valid one. Passing criticalPathDays skips the engine's forward-pass recalc
    // since we already ran full CPM.
    const base: ProjectSchedule = existing
      ? { ...existing }
      : buildScheduleFromTasks(
          `${proj.name} Schedule`,
          proj.id,
          mappedTasks,
          null,
          { startDate: scheduleStartDate, criticalPathDays: projectFinish },
        );

    const nextSchedule: ProjectSchedule = {
      ...base,
      startDate: base.startDate ?? scheduleStartDate,
      tasks: mappedTasks,
      resources: mergedResources,
      baselines,
      scenarios: existingScenarios,
      // Show the imported plan, not the pre-import backup scenario.
      activeScenarioId: null,
      criticalPathDays: projectFinish,
      totalDurationDays: projectFinish,
      updatedAt: new Date().toISOString(),
    };

    updateProject(proj.id, { schedule: nextSchedule });
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    nailIt(`Imported ${mappedTasks.length} task(s) into the schedule.`);
    router.back();
  }, [updateProject, router]);

  const runImport = useCallback(() => {
    if (!result || !project) return;
    try {
      setImporting(true);
      const scheduleStartDate = project.schedule?.startDate ?? todayISO();
      const workingDaysPerWeek = project.schedule?.workingDaysPerWeek ?? 5;

      const { tasks: mappedTasks } = mapRowsToScheduleTasks(result.rows, {
        scheduleStartDate,
        workingDaysPerWeek,
      });
      if (mappedTasks.length === 0) {
        oops('No named tasks to import.');
        return;
      }

      // Validate with the real CPM engine — surfaces cycles / anchor conflicts.
      const cpm = runCpm(mappedTasks, {
        scheduleStartDate,
        workingDaysPerWeek,
        criticalFloatThresholdDays: project.schedule?.criticalFloatThresholdDays,
      });

      const commit = () => persist(project, mappedTasks, cpm.projectFinish, scheduleStartDate);
      const existingCount = project.schedule?.tasks?.length ?? 0;

      // Replacing a non-empty schedule is destructive — this import REPLACES the
      // whole task list. Warn before commit on every path when a plan exists,
      // and flag when the import is materially smaller (a common sign of a
      // mis-mapped or partial export).
      const shrinkNote = existingCount > 0 && mappedTasks.length < existingCount
        ? ` The import has fewer tasks (${mappedTasks.length}) than your current plan (${existingCount}) — double-check the mapping.`
        : '';
      const replaceLine =
        `This replaces your existing ${existingCount} task${existingCount === 1 ? '' : 's'} with ${mappedTasks.length} imported task${mappedTasks.length === 1 ? '' : 's'}.${shrinkNote}\n\nYour current plan is saved as a restore point first (What-If Scenarios → Restore).`;

      if (cpm.conflicts.length > 0) {
        setImporting(false);
        const conflictLine = `${cpm.conflicts.length} cycle/anchor conflict(s) were found. You can import anyway and fix them in Schedule Pro.`;
        showAlert(
          existingCount > 0 ? 'Replace schedule with conflicts?' : 'Schedule has conflicts',
          existingCount > 0 ? `${replaceLine}\n\n${conflictLine}` : conflictLine,
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: existingCount > 0 ? 'Replace' : 'Import anyway',
              style: existingCount > 0 ? 'destructive' : 'default',
              onPress: () => { setImporting(true); commit(); setImporting(false); },
            },
          ],
        );
        return;
      }

      if (existingCount > 0) {
        setImporting(false);
        showAlert(
          'Replace current schedule?',
          replaceLine,
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Replace',
              style: 'destructive',
              onPress: () => { setImporting(true); commit(); setImporting(false); },
            },
          ],
        );
        return;
      }

      commit();
    } catch (err) {
      console.error('[ScheduleImport] import failed', err);
      showAlert('Import failed', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setImporting(false);
    }
  }, [result, project, persist]);

  // ── Locked (below Pro) ────────────────────────────────────────────────────
  if (!allowed) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <TopBar title="Import Schedule" onBack={() => router.back()} styles={styles} color={themeColors.text} />
        <View style={styles.lockWrap}>
          <View style={styles.lockIcon}><Lock size={26} color={themeColors.accent} strokeWidth={1.75} /></View>
          <Text style={styles.lockTitle}>Schedule import is a Pro feature</Text>
          <Text style={styles.lockSub}>
            Bring your Excel or MS Project schedules straight into Schedule Pro — with dependencies,
            durations and constraints mapped automatically.
          </Text>
          <TouchableOpacity style={styles.upgradeBtn} onPress={() => router.push('/paywall' as never)} activeOpacity={0.85}>
            <Text style={styles.upgradeBtnText}>See Pro plans</Text>
            <ArrowRight size={16} color={Colors.textOnAccent} strokeWidth={1.75} />
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const isXlsx = result?.format === 'xlsx';

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <TopBar title="Import Schedule" onBack={() => router.back()} styles={styles} color={themeColors.text} />
      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <View style={styles.heroIcon}><FileInput size={24} color={themeColors.accent} strokeWidth={1.75} /></View>
          <Text style={styles.heroTitle}>Import a schedule</Text>
          <Text style={styles.heroSub}>
            Bring in an Excel (.xlsx) or MS Project (.xml) schedule. Tasks, durations, dependencies
            and constraints are mapped into Schedule Pro. Your current plan is saved as a restore
            point first, so you can bring it back anytime.
          </Text>
        </View>

        {!isSupabaseConfigured && (
          <View style={styles.hintCard}>
            <AlertTriangle size={14} color={themeColors.textSecondary} strokeWidth={1.75} />
            <Text style={styles.hintText}>Import needs a network connection — you appear to be offline.</Text>
          </View>
        )}

        {!project && (
          <View style={styles.hintCard}>
            <AlertTriangle size={14} color={themeColors.textSecondary} strokeWidth={1.75} />
            <Text style={styles.hintText}>No project selected. Open this from a project&apos;s Schedule Pro.</Text>
          </View>
        )}

        <TouchableOpacity
          style={styles.pickBtn}
          onPress={pickFile}
          disabled={busy || !project || !isSupabaseConfigured}
          activeOpacity={0.85}
          testID="pick-schedule-file"
        >
          {busy ? <ActivityIndicator color={themeColors.accent} /> : (
            <>
              <Upload size={18} color={themeColors.accent} strokeWidth={1.75} />
              <Text style={styles.pickBtnText}>{result ? 'Choose a different file' : 'Choose a schedule (.xlsx / .xml)'}</Text>
            </>
          )}
        </TouchableOpacity>

        {result && (
          <>
            <View style={styles.fileRow}>
              {isXlsx
                ? <FileSpreadsheet size={16} color={themeColors.accent} strokeWidth={1.75} />
                : <FileCode2 size={16} color={themeColors.accent} strokeWidth={1.75} />}
              <Text style={styles.fileName} numberOfLines={1}>{fileName}</Text>
              <Text style={styles.fileMeta}>{isXlsx ? 'Excel' : 'MS Project'}</Text>
            </View>

            {/* Warnings */}
            {result.warnings.length > 0 && (
              <>
                <Text style={styles.sectionLabel}>HEADS UP</Text>
                <View style={styles.card}>
                  {result.warnings.map((w, i) => (
                    <View key={`${w.code}-${i}`} style={[styles.warnRow, i === result.warnings.length - 1 && { borderBottomWidth: 0 }]}>
                      <AlertTriangle size={14} color={Colors.warning} strokeWidth={1.75} />
                      <Text style={styles.warnText}>{w.message}</Text>
                    </View>
                  ))}
                </View>
              </>
            )}

            {/* Detected columns (Excel only) */}
            {isXlsx && detectedColumns.length > 0 && (
              <>
                <Text style={styles.sectionLabel}>DETECTED COLUMNS</Text>
                <View style={styles.card}>
                  {detectedColumns.map((d, i) => (
                    <View key={d.label} style={[styles.mapRow, i === detectedColumns.length - 1 && { borderBottomWidth: 0 }]}>
                      <Text style={styles.mapField}>{d.label}</Text>
                      <View style={styles.mapArrowWrap}>
                        <ArrowRight size={12} color={themeColors.textSecondary} strokeWidth={1.75} />
                        <Text style={styles.mapCol} numberOfLines={1}>{d.col}</Text>
                      </View>
                    </View>
                  ))}
                </View>
                <View style={styles.hintCard}>
                  <Info size={14} color={themeColors.textSecondary} strokeWidth={1.75} />
                  <Text style={styles.hintText}>
                    Columns were auto-detected. Review the preview below — if anything looks off,
                    rename the headers in Excel (Task, Duration, Start, Predecessors…) and re-import.
                  </Text>
                </View>
              </>
            )}

            {/* Preview */}
            <Text style={styles.sectionLabel}>
              PREVIEW · {importableCount} task{importableCount === 1 ? '' : 's'}
              {result.truncated ? ' (truncated)' : ''}
            </Text>
            <View style={styles.card}>
              {previewRows.length === 0 ? (
                <View style={styles.emptyRow}>
                  <Text style={styles.emptyText}>No importable tasks were found in this file.</Text>
                </View>
              ) : previewRows.map((r, i) => (
                <View key={r.sourceId} style={[styles.previewRow, i === previewRows.length - 1 && { borderBottomWidth: 0 }]}>
                  {r.title
                    ? <Text style={styles.previewTitle} numberOfLines={1}>{r.title}</Text>
                    : <Text style={[styles.previewTitle, styles.previewMuted]}>(no name)</Text>}
                  <View style={styles.previewMetaRow}>
                    {r.rawDuration ? (
                      <View style={styles.previewMetaItem}>
                        <CalendarClock size={11} color={themeColors.textSecondary} strokeWidth={1.75} />
                        <Text style={styles.previewMeta}>{r.rawDuration}</Text>
                      </View>
                    ) : null}
                    {r.rawStart ? <Text style={styles.previewMeta}>{r.rawStart}</Text> : null}
                    {r.rawPredecessors ? <Text style={styles.previewMeta}>pred {r.rawPredecessors}</Text> : null}
                  </View>
                </View>
              ))}
              {importableCount > previewRows.length && (
                <View style={styles.moreRow}>
                  <Text style={styles.moreText}>+{importableCount - previewRows.length} more</Text>
                </View>
              )}
            </View>

            {/* Import */}
            <TouchableOpacity
              style={[styles.importBtn, (importableCount === 0 || importing || !project) && styles.importBtnDisabled]}
              onPress={runImport}
              disabled={importableCount === 0 || importing || !project}
              activeOpacity={0.85}
              testID="run-schedule-import"
            >
              {importing ? <ActivityIndicator color={Colors.textOnAccent} /> : (
                <>
                  <ListChecks size={18} color={Colors.textOnAccent} strokeWidth={1.75} />
                  <Text style={styles.importBtnText}>
                    {importableCount > 0 ? `Import ${importableCount} task${importableCount === 1 ? '' : 's'}` : 'Nothing to import'}
                  </Text>
                </>
              )}
            </TouchableOpacity>

            <View style={styles.roBadge}>
              <CheckCircle2 size={13} color={themeColors.success} strokeWidth={1.75} />
              <Text style={styles.roBadgeText}>
                Your current schedule is saved as a restore point before the import replaces it —
                bring it back anytime from What-If Scenarios → Restore.
              </Text>
            </View>
          </>
        )}

        {!result && !busy && (
          <View style={styles.hintCard}>
            <Info size={14} color={themeColors.textSecondary} strokeWidth={1.75} />
            <Text style={styles.hintText}>
              Export from Excel as .xlsx, or from MS Project as XML (File → Save As → XML). MAGE reads
              the FS/SS/FF/SF dependencies, lags, durations and constraints.
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function TopBar({ title, onBack, styles, color }: {
  title: string; onBack: () => void; styles: ReturnType<typeof makeStyles>; color: string;
}) {
  return (
    <View style={styles.topBar}>
      <TouchableOpacity onPress={onBack} style={styles.backBtn} activeOpacity={0.7} testID="schedule-import-back">
        <ChevronLeft size={24} color={color} strokeWidth={2} />
      </TouchableOpacity>
      <Text style={styles.topBarTitle}>{title}</Text>
      <View style={styles.backBtn} />
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  scroll: { padding: 16 },

  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 8, paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.line,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  topBarTitle: { fontSize: Type.headline.fontSize, fontWeight: '700', color: t.text },

  hero: {
    backgroundColor: t.surface, borderRadius: Tokens.radius.panel, padding: 20,
    borderWidth: 1, borderColor: t.line, marginBottom: 20, gap: 10,
  },
  heroIcon: {
    width: 44, height: 44, borderRadius: Tokens.radius.card,
    backgroundColor: `${t.accent}15`, alignItems: 'center', justifyContent: 'center',
  },
  heroTitle: { fontSize: Type.title2.fontSize, fontWeight: '700', color: t.text },
  heroSub: { fontSize: Type.bodyCompact.fontSize, color: t.textSecondary, lineHeight: 20 },

  roBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: `${t.success}12`, padding: 10, borderRadius: Tokens.radius.md, marginTop: 16,
  },
  roBadgeText: { flex: 1, fontSize: Type.caption1.fontSize, color: t.textSecondary, lineHeight: 16 },

  pickBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: `${t.accent}12`, borderWidth: 1, borderColor: `${t.accent}30`,
    paddingVertical: 14, borderRadius: Tokens.radius.card, marginBottom: 16,
  },
  pickBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '700', color: t.accent },

  fileRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: t.surface, borderRadius: Tokens.radius.card, borderWidth: 1, borderColor: t.line,
    paddingHorizontal: 14, paddingVertical: 12, marginBottom: 16,
  },
  fileName: { flex: 1, fontSize: Type.footnote.fontSize, color: t.text, fontWeight: '600' },
  fileMeta: { fontSize: Type.caption1.fontSize, color: t.textSecondary },

  sectionLabel: {
    fontSize: Type.caption2.fontSize, fontWeight: '600', color: t.textSecondary,
    letterSpacing: 0.8, marginBottom: 8, marginTop: 4,
  },
  card: {
    backgroundColor: t.surface, borderRadius: Tokens.radius.card, borderWidth: 1, borderColor: t.line,
    overflow: 'hidden', marginBottom: 16,
  },

  warnRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    paddingHorizontal: 14, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.line,
  },
  warnText: { flex: 1, fontSize: Type.footnote.fontSize, color: t.text, lineHeight: 18 },

  mapRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.line,
  },
  mapField: { fontSize: Type.footnote.fontSize, color: t.text, fontWeight: '600' },
  mapArrowWrap: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1, maxWidth: '60%' },
  mapCol: { fontSize: Type.footnote.fontSize, color: t.textSecondary },

  previewRow: {
    paddingHorizontal: 14, paddingVertical: 11, gap: 4,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.line,
  },
  previewTitle: { fontSize: Type.bodyCompact.fontSize, color: t.text, fontWeight: '600' },
  previewMuted: { color: t.textMuted, fontStyle: 'italic' },
  previewMetaRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
  previewMetaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  previewMeta: { fontSize: Type.caption1.fontSize, color: t.textSecondary },
  moreRow: { paddingHorizontal: 14, paddingVertical: 10 },
  moreText: { fontSize: Type.caption1.fontSize, color: t.textSecondary, fontWeight: '600' },
  emptyRow: { paddingHorizontal: 14, paddingVertical: 16 },
  emptyText: { fontSize: Type.footnote.fontSize, color: t.textSecondary },

  hintCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: `${t.accent}08`, padding: 12, borderRadius: Tokens.radius.md, marginBottom: 16,
  },
  hintText: { flex: 1, fontSize: Type.caption1.fontSize, color: t.textSecondary, lineHeight: 17 },

  importBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: t.accentFill, paddingVertical: 16, borderRadius: Tokens.radius.card,
  },
  importBtnDisabled: { opacity: 0.5 },
  importBtnText: { color: Colors.textOnAccent, fontWeight: '700', fontSize: Type.subhead.fontSize },

  // Locked state
  lockWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  lockIcon: {
    width: 60, height: 60, borderRadius: Tokens.radius.full, backgroundColor: `${t.accent}15`,
    alignItems: 'center', justifyContent: 'center',
  },
  lockTitle: { fontSize: Type.title3.fontSize, fontWeight: '800', color: t.text, textAlign: 'center' },
  lockSub: { fontSize: Type.bodyCompact.fontSize, color: t.textSecondary, textAlign: 'center', lineHeight: 20 },
  upgradeBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8,
    backgroundColor: t.accentFill, paddingVertical: 13, paddingHorizontal: 24, borderRadius: Tokens.radius.card,
  },
  upgradeBtnText: { color: Colors.textOnAccent, fontWeight: '700', fontSize: Type.subhead.fontSize },
});
