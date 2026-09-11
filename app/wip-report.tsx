import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, TextInput, Keyboard,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import { Stack, useRouter } from 'expo-router';
import { ChevronLeft, TrendingUp, Lock, FileSpreadsheet, X, AlertTriangle, HelpCircle } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

import { useAuth } from '@/contexts/AuthContext';
import { useProjects } from '@/contexts/ProjectContext';
import { useWip } from '@/contexts/WipContext';
import {
  computeWipRow, computeWipPortfolio, flagWipRow,
  suggestBilledToDate, sumApprovedChangeOrders, isWipReportableProject,
  deriveOriginalContractWithSource, deriveEstimatedCostWithSource,
  suggestCostToDateWithSource, WIP_SOURCE_LABELS, wipSourceLabel,
  type WipRowSources, type WipSnapshotRowWithSources, type WipPeriodWithSources,
} from '@/utils/wip';
import { FeatureExplainerSheet } from '@/components/FeatureExplainerSheet';
import { useMaterialReceipts } from '@/hooks/useMaterialReceipts';
import { wipPeriodToCSV, shareWipPeriodPdf } from '@/utils/wipExport';
import { copyToClipboard } from '@/utils/clipboard';
import type { WipRowInput, Project } from '@/types';
import { showAlert } from '@/utils/alert';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { supabaseWrite } from '@/utils/offlineQueue';

function money(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}
function pct(n: number): string {
  return `${(n * 100).toFixed(0)}%`;
}

// Per-project cost-to-date overrides. Tenant-namespaced by user id so switching
// accounts on one device never bleeds one company's cost figures into another's
// view.
//
// AsyncStorage is now the OFFLINE READ CACHE, not the record. The server is
// (public.wip_cost_overrides, migration 20260908120100). The failure that moved
// it: a GC types $340,000 of self-performed labor — the part subs+materials
// cannot see — into this override on his laptop, then opens WIP on his PHONE
// where the map was empty, and the screen silently fell back to the lower
// bound. He froze the period and exported it, and the locked period DOES sync
// (contexts/WipContext.tsx), so what reached his surety was a schedule that had
// quietly reverted to a number he had already corrected.
//
// One row per project, never the whole Record as a blob: correcting Henderson
// on the phone must not wipe the Ridgeline override typed on the laptop.
const WIP_COST_OVERRIDES_KEY = 'mageid_wip_cost_overrides';
const WIP_COST_OVERRIDES_TABLE = 'wip_cost_overrides';
function costOverridesKey(userId: string | undefined): string {
  return userId ? `${WIP_COST_OVERRIDES_KEY}_${userId}` : WIP_COST_OVERRIDES_KEY;
}

/**
 * One project's typed cost-to-date. `value` is COST incurred, not revenue.
 * `updatedAt` is an INSTANT (not a calendar day) — it is what decides whose
 * edit is newer when the phone and the laptop disagree. `synced` records
 * whether the server has taken this value yet, so the screen can say "this
 * device only" instead of letting the GC assume every device agrees.
 */
interface CostOverride {
  value: number;
  updatedAt: string;
  synced: boolean;
  /**
   * The GC took the override back off — he cleared the box, or typed the app's
   * own figure back in. Kept as a dated entry rather than dropped from the map
   * because the SERVER still holds the row: delete it locally and the next
   * read-through hands the override straight back, so "clear" would not
   * survive a reload. A tombstone wins the same updatedAt comparison a new
   * figure would.
   *
   * `value` on a tombstone is inert. It carries the AUTOMATIC figure rather
   * than the one that was taken off, so a reader that forgets to check this
   * flag falls back to the app's own number instead of resurrecting the one
   * the GC just rejected.
   */
  cleared?: boolean;
}

/**
 * The override actually in force for a project, or undefined when there is
 * none. A tombstone is a record of a removal, never a figure — reading one as
 * a cost-to-date would put a stale number back on a bank-facing schedule.
 */
function overrideInForce(
  map: Record<string, CostOverride>,
  projectId: string,
): CostOverride | undefined {
  const entry = map[projectId];
  return entry && !entry.cleared ? entry : undefined;
}

// Overrides written before this screen learned to sync were bare numbers with
// no timestamp. Stamping them at the epoch means a server row — which by
// definition was typed after the sync shipped — wins, while an override that
// exists on NO other device is still kept and backfilled up on the next load.
const LEGACY_OVERRIDE_STAMP = '1970-01-01T00:00:00.000Z';

function normalizeOverrides(raw: unknown): Record<string, CostOverride> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, CostOverride> = {};
  for (const [projectId, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof entry === 'number' && Number.isFinite(entry)) {
      out[projectId] = { value: entry, updatedAt: LEGACY_OVERRIDE_STAMP, synced: false };
      continue;
    }
    if (entry && typeof entry === 'object') {
      const e = entry as Partial<CostOverride>;
      if (typeof e.value === 'number' && Number.isFinite(e.value)) {
        out[projectId] = {
          value: e.value,
          updatedAt: typeof e.updatedAt === 'string' ? e.updatedAt : LEGACY_OVERRIDE_STAMP,
          synced: e.synced === true,
          cleared: e.cleared === true,
        };
      }
    }
  }
  return out;
}

export default function WipReportScreen() {
  const router = useRouter();
  const { canAccess } = useTierAccess();
  if (!canAccess('wip_reporting')) {
    return (
      <Paywall
        visible={true}
        feature="WIP Reporting"
        requiredTier="business"
        onClose={() => router.back()}
      />
    );
  }
  return <WipReportScreenInner />;
}

function WipReportScreenInner() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { isDesktop } = useResponsiveLayout();

  const {
    projects,
    getChangeOrdersForProject,
    getCommitmentsForProject,
    getInvoicesForProject,
    getAIAPayAppsForProject,
  } = useProjects();
  const { periods, addPeriod, lockPeriod } = useWip();
  const { getReceiptsForProject } = useMaterialReceipts();
  const { user } = useAuth();
  const userId = user?.id;

  // Per-project cost-to-date overrides (keyed by project id). Read through from
  // the server on load, written through on change; AsyncStorage is the offline
  // cache in front of it.
  const [costOverrides, setCostOverrides] = useState<Record<string, CostOverride>>({});
  // Gate persistence on hydration so the initial empty state doesn't clobber
  // cached overrides before they load in.
  const overridesHydratedRef = useRef(false);

  // Push one override to the server through the offline queue — never a direct
  // supabase.from().upsert, so an override typed in a basement with no signal
  // drains when the phone comes back up like every other write in this app.
  // `upsert` (not insert) because the primary key is (user_id, project_id): a
  // second edit to the same project is a replace, and a plain insert would come
  // back as a duplicate-key violation, which the queue classifies as terminal —
  // the correction would be discarded, which is the bug this closes.
  const pushOverride = useCallback(async (projectId: string, entry: CostOverride) => {
    if (!userId || !isSupabaseConfigured) return;
    // A tombstone SYNCS, as `cleared: true`, rather than being dropped here or
    // turned into a delete. utils/offlineQueue.ts deletes by `id` only and this
    // table is keyed (user_id, project_id), so a delete could never leave the
    // device — the row would stay server-side and the GC's other device would
    // read it back and restore the number he just rejected. Upsert is the path
    // that already works, so the clear travels on it (migration 20260908120100).
    const landed = await supabaseWrite(WIP_COST_OVERRIDES_TABLE, 'upsert', {
      user_id: userId,
      project_id: projectId,
      // A tombstone carries the AUTOMATIC figure, never 0, so a reader that
      // forgets `cleared` falls back to the app's own number rather than
      // asserting the job has cost nothing.
      cost_to_date: entry.value,   // COST incurred, not revenue
      cleared: entry.cleared === true,
      // Sent explicitly rather than left to the column's default now(): this is
      // the stamp the merge on the OTHER device compares against, so it has to
      // be the moment the GC typed the figure, not the moment a queued write
      // happened to drain.
      updated_at: entry.updatedAt,
    });
    if (!landed) return; // queued or refused — the row keeps saying "not yet synced"
    setCostOverrides((prev) => {
      const current = prev[projectId];
      // A newer edit landed while this write was in flight — don't stamp it
      // synced, its own write will.
      if (!current || current.updatedAt !== entry.updatedAt) return prev;
      return { ...prev, [projectId]: { ...current, synced: true } };
    });
  }, [userId]);

  // Hydrate whenever the tenant changes. Clear first so a prior account's cost
  // figures never linger, read the cache for an immediate paint, then let the
  // server correct it. Newest edit wins per project, compared on updatedAt —
  // an override typed here and still sitting in the offline queue must not be
  // overwritten by the older row the server still has.
  useEffect(() => {
    let cancelled = false;
    overridesHydratedRef.current = false;
    setCostOverrides({});
    (async () => {
      let merged: Record<string, CostOverride> = {};
      try {
        const raw = await AsyncStorage.getItem(costOverridesKey(userId));
        if (raw) merged = normalizeOverrides(JSON.parse(raw));
      } catch { /* fresh install / bad cache → the server is the answer */ }
      if (cancelled) return;
      // Paint the cache NOW, before the round-trip. The comment above always
      // promised this and the code did not do it: every override was held
      // behind the server read, so for as long as that request took — forever,
      // on a hung connection — the schedule showed the subs+materials lower
      // bound with "est. (tap to add labor)" beside it, and Save period would
      // have frozen that. That is the same failure this whole change exists to
      // close, narrowed to the seconds after the screen opens.
      if (Object.keys(merged).length > 0) setCostOverrides(merged);

      const backfill: [string, CostOverride][] = [];
      if (userId && isSupabaseConfigured) {
        try {
          const { data, error } = await supabase
            .from(WIP_COST_OVERRIDES_TABLE)
            .select('project_id, cost_to_date, cleared, updated_at')
            // RLS already scopes this to the caller; the filter is the second
            // lock, so one misapplied policy cannot put another company's cost
            // figures on this GC's schedule.
            .eq('user_id', userId);
          if (cancelled) return;
          if (!error && Array.isArray(data)) {
            for (const raw of data as { project_id?: string; cost_to_date?: number | string | null; cleared?: boolean | null; updated_at?: string }[]) {
              const projectId = raw.project_id;
              if (!projectId || raw.cost_to_date === null || raw.cost_to_date === undefined) continue;
              const value = Number(raw.cost_to_date);   // a numeric column arrives as a string
              if (!Number.isFinite(value)) continue;
              // Both sides are INSTANTS, and they are spelled differently:
              // PostgREST returns "2026-09-08T12:01:00.123456+00:00" while this
              // device stamps "2026-09-08T12:01:00.123Z". Comparing those as
              // strings sorts '+' before 'Z' and compares microseconds against
              // milliseconds — the laptop's newer figure would lose to the
              // phone's older one, which is the failure this whole change is
              // about. Parse to milliseconds and compare numbers.
              const serverMs = Date.parse(raw.updated_at ?? '');
              const serverAt = Number.isFinite(serverMs)
                ? new Date(serverMs).toISOString()
                : LEGACY_OVERRIDE_STAMP;
              const local = merged[projectId];
              if (local && Date.parse(local.updatedAt) > Date.parse(serverAt)) continue; // ours is newer
              // `cleared` travels. Without it the OTHER device's clear is
              // invisible here and this load restores the override the GC took
              // off — the same last-writer-wins failure the timestamp compare
              // above exists to prevent, one column over.
              merged[projectId] = { value, updatedAt: serverAt, synced: true, cleared: raw.cleared === true };
            }
            // Anything the server has never seen — overrides typed before this
            // screen synced, or while offline — goes up now, so the GC's other
            // device stops silently showing the subs+materials lower bound.
            // Tombstones included: a clear made offline is exactly as much a
            // pending write as a typed figure, and it now has a column to land
            // in. `synced` is what gates this, not `cleared` — an entry already
            // acknowledged by the server is not re-sent either way, so a clear
            // cannot be re-uploaded on every mount.
            for (const [projectId, entry] of Object.entries(merged)) {
              if (!entry.synced) backfill.push([projectId, entry]);
            }
          }
        } catch { /* offline → the cache stands, and the writes are queued */ }
      }
      if (cancelled) return;
      // Anything the GC typed while the round-trip was in flight is NEWER than
      // everything this load is carrying, and a flat replace would wipe it off
      // the screen seconds after he entered it — the same last-writer-wins
      // shape the per-project rows exist to avoid. Same comparison as the
      // server merge above: both sides are INSTANTS.
      setCostOverrides((typedWhileLoading) => {
        const next = { ...merged };
        for (const [projectId, entry] of Object.entries(typedWhileLoading)) {
          const loaded = next[projectId];
          if (!loaded || Date.parse(entry.updatedAt) > Date.parse(loaded.updatedAt)) {
            next[projectId] = entry;
          }
        }
        return next;
      });
      overridesHydratedRef.current = true;
      for (const [projectId, entry] of backfill) void pushOverride(projectId, entry);
    })();
    return () => { cancelled = true; };
  }, [userId, pushOverride]);

  // Persist the cache on every change once hydrated. Cheap write; overrides are
  // a small map, and this is only the offline copy of the server's rows.
  useEffect(() => {
    if (!overridesHydratedRef.current) return;
    void AsyncStorage.setItem(costOverridesKey(userId), JSON.stringify(costOverrides))
      .catch(() => { /* non-fatal cache write */ });
  }, [costOverrides, userId]);
  const [drillProjectId, setDrillProjectId] = useState<string | null>(null);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null);
  // Controlled buffer for the drill-in cost-to-date field so a typed-but-not-
  // blurred value is captured on close (uncontrolled defaultValue + onEndEditing
  // silently dropped edits when the user tapped X without dismissing the keyboard).
  const [drillCostText, setDrillCostText] = useState<string>('');

  // Audit 2026-09-07 ("Do next" #2, axis 4). This was `() => projects` — every
  // project, CLOSED ones included — while utils/financialReports.computeWIPReport,
  // one sidebar row away, has always skipped closed jobs. So the two bank-facing
  // WIP schedules in this app listed different jobs and restated backlog that no
  // longer exists on a document a surety sizes a bond from. The population is
  // now the shared predicate; neither surface gets its own opinion.
  const activeProjects: Project[] = useMemo(
    () => projects.filter(isWipReportableProject),
    [projects],
  );
  const closedCount = projects.length - activeProjects.length;

  // Build one project's WIP inputs AND the provenance of each one, in a single
  // pass. Two passes is how the number and the explanation drift apart, and
  // this schedule is the document a surety underwrites — so the branch that
  // produced a figure is read from the same call that produced the figure
  // (audit 2026-09-07, "Worth doing" #26).
  const buildRow = useCallback((project: Project): {
    input: WipRowInput;
    sources: WipRowSources;
    /** What the app can see on its own — the subs+materials lower bound. */
    auto: ReturnType<typeof suggestCostToDateWithSource>;
    override: CostOverride | undefined;
  } => {
    const cos = getChangeOrdersForProject(project.id);
    const commitments = getCommitmentsForProject(project.id);
    const invoices = getInvoicesForProject(project.id);
    const payApps = getAIAPayAppsForProject(project.id);
    const receipts = getReceiptsForProject(project.id);

    // Revenue baseline (contract) and cost budget come from DISTINCT sources
    // so est gross profit doesn't collapse to ~0 when both fall back to
    // targetBudget: contract from AIA/CO/targetBudget, cost from the estimate.
    const contract = deriveOriginalContractWithSource(project, cos, payApps);
    const approvedChangeOrders = sumApprovedChangeOrders(cos);
    // Pass the CO figures so the COST budget grows with them too. Without
    // this the revenue side gains the change order and the cost side does
    // not, which reports every CO at 100% margin.
    const cost = deriveEstimatedCostWithSource(project, commitments, {
      approvedChangeOrders,
      originalContract: contract.value,
    });
    const auto = suggestCostToDateWithSource(commitments, receipts);
    const override = overrideInForce(costOverrides, project.id);

    return {
      input: {
        originalContract: contract.value,
        approvedChangeOrders,
        totalEstimatedCost: cost.value,
        costToDate: override ? override.value : auto.value,
        billedToDate: suggestBilledToDate(invoices, payApps),
      },
      sources: {
        originalContract: contract.source,
        totalEstimatedCost: cost.source,
        // A typed figure that has not reached the server yet says so. That is
        // the disclosure the whole finding was missing: the number changed
        // between two devices and nothing told anyone.
        costToDate: override
          ? (override.synced ? 'entered_and_synced' : 'entered_on_this_device')
          : auto.source,
      },
      auto,
      override,
    };
  }, [costOverrides, getChangeOrdersForProject, getCommitmentsForProject, getInvoicesForProject, getAIAPayAppsForProject, getReceiptsForProject]);

  const buildInput = useCallback(
    (project: Project): WipRowInput => buildRow(project).input,
    [buildRow],
  );

  // Snapshot rows carry their provenance, so a period locked in March can still
  // answer the surety's question in June — recomputing it at export time would
  // explain today's projects, not the figures the export is printing.
  const liveRows: WipSnapshotRowWithSources[] = useMemo(
    () => activeProjects.map((p) => {
      const { input, sources } = buildRow(p);
      return { projectId: p.id, projectName: p.name, input, output: computeWipRow(input), sources };
    }),
    [activeProjects, buildRow],
  );

  const portfolio = useMemo(() => computeWipPortfolio(liveRows), [liveRows]);

  // Prior locked period, for the profit-fade watch.
  const priorPeriod = useMemo(
    () => periods.filter((p) => p.lockedAt)
      .sort((a, b) => b.periodEndDate.localeCompare(a.periodEndDate))[0],
    [periods],
  );

  const [explainerOpen, setExplainerOpen] = useState(false);

  const drillProject = activeProjects.find((p) => p.id === drillProjectId) ?? null;
  const drillRow = drillProject ? buildRow(drillProject) : null;
  const drillInput = drillRow?.input ?? null;
  const drillOutput = drillInput ? computeWipRow(drillInput) : null;
  const drillPriorRow = priorPeriod?.rows.find((r) => r.projectId === drillProjectId)?.output;
  const drillFlags = drillOutput ? flagWipRow(drillOutput, drillPriorRow) : null;

  // Open the drill modal and seed the controlled cost buffer from the current
  // (override-or-suggested) cost-to-date so the field starts at the live value.
  const openDrill = useCallback((projectId: string) => {
    const proj = activeProjects.find((p) => p.id === projectId);
    const seeded = proj ? buildInput(proj).costToDate : 0;
    setDrillCostText(String(Math.round(seeded)));
    setDrillProjectId(projectId);
  }, [activeProjects, buildInput]);

  // Commit the typed cost-to-date into the per-project override and push it to
  // the server. Called on blur AND on close so an edit isn't lost if the
  // keyboard is never dismissed — which is why it must be idempotent: it fires
  // twice with the same text on a normal close.
  //
  // Opening the drill-in and closing it without typing must NOT create an
  // override. The field is seeded with the current figure, so recording it
  // blindly turned the app's own suggestion into "entered by you" — a lie in
  // the Source column of a document a banker reads, and it would have written
  // a row to the server saying so.
  const commitDrillCost = useCallback(() => {
    if (!drillProjectId) return;
    const project = activeProjects.find((p) => p.id === drillProjectId);
    if (!project) return;
    const { auto, override } = buildRow(project);

    const cleaned = drillCostText.replace(/[^0-9.]/g, '');
    const typed = Number(cleaned);
    // An EMPTY box means "use the app's own figure", not "$0 of cost incurred",
    // and it used to be read as the second: Number('') is 0, so wiping the
    // field recorded a $0 COST override. On a 30%-complete job that turned a
    // $45k overbilling into a $500k one, dropped earned revenue to $0, and
    // flagged nothing — and with this wave's sync it would have carried that
    // $0 to the GC's other device stamped "entered by you". A string this app
    // cannot parse ("1.2.3") is the same class: not a number, so record
    // nothing and leave the previous figure standing. Typing "0" still records
    // a deliberate zero, because "0" has a digit in it.
    const emptied = !/[0-9]/.test(cleaned);
    if (!emptied && !Number.isFinite(typed)) return;

    // Typing the automatic figure back in is how a GC takes an override off —
    // there is no other control, and clearing the box is the same request. It
    // used to record the app's own estimate as "entered by you", which both
    // lied in the Source column and left him no route back at all.
    if (emptied || Math.round(typed) === Math.round(auto.value)) {
      if (!override) return;   // nothing in force — opening and closing changes nothing
      const tombstone: CostOverride = {
        value: auto.value,
        updatedAt: new Date().toISOString(),
        synced: false,
        cleared: true,
      };
      setCostOverrides((prev) => ({ ...prev, [drillProjectId]: tombstone }));
      return;
    }

    // Rounded, because openDrill seeds the field with Math.round of the current
    // figure: an override of $222,000.37 comes back as "222000" and a strict
    // compare would read that as a new entry, re-stamping and re-syncing it
    // every time the sheet is opened and closed.
    if (override && Math.round(override.value) === Math.round(typed)) return;
    const entry: CostOverride = { value: typed, updatedAt: new Date().toISOString(), synced: false };
    setCostOverrides((prev) => ({ ...prev, [drillProjectId]: entry }));
    void pushOverride(drillProjectId, entry);
  }, [drillProjectId, drillCostText, activeProjects, buildRow, pushOverride]);

  const closeDrill = useCallback(() => {
    commitDrillCost();
    Keyboard.dismiss();
    setDrillProjectId(null);
  }, [commitDrillCost]);

  const handleSnapshot = useCallback(() => {
    const periodEndDate = new Date().toISOString().slice(0, 10);
    addPeriod({ periodEndDate, rows: liveRows, portfolioTotals: portfolio });
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    showAlert('Period saved', `WIP snapshot for ${periodEndDate} created. Lock it to freeze for CPA/bank review.`);
  }, [addPeriod, liveRows, portfolio]);

  const handleLock = useCallback(() => {
    const target = selectedPeriodId ? periods.find((p) => p.id === selectedPeriodId) : periods[0];
    if (!target) { showAlert('No period', 'Save a period snapshot first, then lock it.'); return; }
    if (target.lockedAt) { showAlert('Already locked', 'This period is immutable. Create a new period to make changes.'); return; }
    showAlert('Lock period?', `Locking freezes ${target.periodEndDate}. It can no longer be edited.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Lock', style: 'destructive', onPress: () => { lockPeriod(target.id); void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); } },
    ]);
  }, [selectedPeriodId, periods, lockPeriod]);

  const exportPeriod = useMemo((): WipPeriodWithSources | null => {
    if (selectedPeriodId) return periods.find((p) => p.id === selectedPeriodId) ?? null;
    // Fall back to a live (unsaved) period shape for export.
    return {
      id: 'live', periodEndDate: new Date().toISOString().slice(0, 10),
      createdAt: new Date().toISOString(), rows: liveRows, portfolioTotals: portfolio,
    };
  }, [selectedPeriodId, periods, liveRows, portfolio]);

  const handleExportCsv = useCallback(async () => {
    if (!exportPeriod) return;
    const csv = wipPeriodToCSV(exportPeriod);
    const ok = await copyToClipboard(csv);
    if (ok) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    showAlert(ok ? 'CSV copied' : 'Copy failed', ok ? 'Paste into Excel / QuickBooks / Sage.' : 'Could not copy CSV.');
  }, [exportPeriod]);

  const handleExportPdf = useCallback(async () => {
    if (!exportPeriod) return;
    try { await shareWipPeriodPdf(exportPeriod, 'MAGE ID'); }
    catch { showAlert('Export failed', 'Could not generate the WIP PDF.'); }
  }, [exportPeriod]);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back">
          <ChevronLeft size={26} color={themeColors.accent} strokeWidth={1.75} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>Financial Reporting</Text>
          <Text style={styles.title}>WIP Report</Text>
        </View>
        {/* Audit 2026-09-07 ("Worth doing" #22): this screen printed
            Overbilling in red and Underbilling in blue with no legend and no
            definition, to residential GCs who have never seen a WIP schedule —
            and underbilling is the one a surety actually asks about. */}
        <TouchableOpacity
          onPress={() => setExplainerOpen(true)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="What is a WIP schedule?"
          testID="wip-explainer-chip"
        >
          <HelpCircle size={20} color={themeColors.textSecondary} strokeWidth={2} />
        </TouchableOpacity>
        <TrendingUp size={22} color={themeColors.accent} strokeWidth={1.75} />
      </View>

      <FeatureExplainerSheet
        visible={explainerOpen}
        onClose={() => setExplainerOpen(false)}
        term="WIP Schedule (Work-In-Progress)"
        definition={
          'A WIP schedule compares what you have EARNED on each job against what you have BILLED for it. '
          + 'Earned revenue is the contract times percent complete, and percent complete is cost-to-date '
          + 'divided by your total estimated cost. Overbilling means you have billed MORE than you have '
          + 'earned — the client is funding you ahead of the work, which is good for cash but is a liability '
          + 'you still owe in labor and materials. Underbilling means you have earned MORE than you have '
          + 'billed — you are financing your client with your own money, and it is the first thing a surety '
          + 'or a lender looks for.'
        }
        whenToUse={[
          'Every month before you close the books — lock the period so the figures cannot move afterward',
          'When a bank or a bonding agent asks for a WIP schedule (they will ask for it by that name)',
          'When a job feels profitable but the bank account disagrees — underbilling is usually why',
        ]}
      />

      <ScrollView {...fabScroll} contentContainerStyle={[{ padding: 16, paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }, isDesktop && styles.contentDesktop]}>
        {/* Portfolio totals */}
        <View style={[styles.card, isDesktop && styles.cardDesktop]}>
          <Text style={styles.sectionTitle}>Portfolio</Text>
          <Row label="Revised contract" value={money(portfolio.revisedContract)} styles={styles} />
          <Row label="Earned revenue" value={money(portfolio.earnedRevenue)} styles={styles} />
          <Row label="Billed to date" value={money(portfolio.billedToDate)} styles={styles} />
          <Row label="Overbilling" value={money(portfolio.overbilling)} styles={styles} />
          <Row label="Underbilling" value={money(portfolio.underbilling)} styles={styles} />
          <Row label="Backlog" value={money(portfolio.backlog)} styles={styles} />
          <Row label="Weighted margin" value={pct(portfolio.weightedMarginPct)} styles={styles} />
        </View>

        {/* Period selector */}
        <View style={[styles.card, isDesktop && styles.cardDesktop]}>
          <Text style={styles.sectionTitle}>Periods</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            <TouchableOpacity
              style={[styles.periodChip, selectedPeriodId === null && styles.periodChipActive]}
              onPress={() => setSelectedPeriodId(null)}>
              <Text style={styles.periodChipText}>Live</Text>
            </TouchableOpacity>
            {periods.map((p) => (
              <TouchableOpacity key={p.id}
                style={[styles.periodChip, selectedPeriodId === p.id && styles.periodChipActive]}
                onPress={() => setSelectedPeriodId(p.id)}>
                {p.lockedAt ? <Lock size={12} color={themeColors.textMuted} strokeWidth={2} /> : null}
                <Text style={styles.periodChipText}>{p.periodEndDate}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <View style={styles.actionRow}>
            <TouchableOpacity style={styles.actionBtn} onPress={handleSnapshot}>
              <Text style={styles.actionBtnText}>Save period</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionBtn} onPress={handleLock}>
              <Lock size={14} color={themeColors.text} strokeWidth={2} />
              <Text style={styles.actionBtnText}>Lock</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.actionRow}>
            <TouchableOpacity style={styles.actionBtn} onPress={handleExportCsv}>
              <FileSpreadsheet size={14} color={themeColors.text} strokeWidth={2} />
              <Text style={styles.actionBtnText}>Export CSV</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionBtn} onPress={handleExportPdf}>
              <Text style={styles.actionBtnText}>Export PDF</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Per-project rows (live) */}
        <View style={[styles.card, isDesktop && styles.cardFullDesktop]}>
          <Text style={styles.sectionTitle}>Projects</Text>
          {/* The two colours below carry the whole meaning of this table, and
              until now nothing on the screen said what they meant. */}
          <View style={styles.legendRow} testID="wip-legend">
            <Text style={styles.legendText}>
              <Text style={styles.over}>Over</Text> = billed more than earned (client is ahead of you) ·{' '}
              <Text style={styles.under}>Under</Text> = earned more than billed (you are financing the client)
            </Text>
          </View>
          {closedCount > 0 ? (
            <Text style={styles.muted}>
              {closedCount} closed project{closedCount === 1 ? ' is' : 's are'} excluded — a WIP schedule
              carries work in progress only.
            </Text>
          ) : null}
          {liveRows.length === 0 ? (
            <Text style={styles.muted}>No active projects.</Text>
          ) : liveRows.map((r) => {
            const prior = priorPeriod?.rows.find((pr) => pr.projectId === r.projectId)?.output;
            const flags = flagWipRow(r.output, prior);
            const flagged = flags.profitFade || flags.billingSwing || flags.scheduleDivergence;
            return (
              <TouchableOpacity key={r.projectId} style={styles.projectRow} onPress={() => openDrill(r.projectId)}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.projectName}>{r.projectName}</Text>
                  <Text style={styles.muted}>{pct(r.output.percentComplete)} complete · {money(r.output.earnedRevenue)} earned</Text>
                  {/* A cost-to-date that came off another device used to be
                      indistinguishable from one typed here and from the
                      subs+materials estimate. All three read the same, and the
                      GC only found out which he had when the surety asked. */}
                  <Text style={styles.muted}>
                    Cost-to-date {money(r.input.costToDate)}
                    {r.sources?.costToDate === 'entered_and_synced'
                      ? ' · entered by you, synced'
                      : r.sources?.costToDate === 'entered_on_this_device'
                        ? ' · entered here, not synced yet'
                        : ' · est. (tap to add labor)'}
                  </Text>
                </View>
                {flagged ? <AlertTriangle size={16} color={themeColors.danger} strokeWidth={2} /> : null}
                <Text style={r.output.overbilling > 0 ? styles.over : styles.under}>
                  {r.output.overbilling > 0 ? `Over ${money(r.output.overbilling)}` : `Under ${money(r.output.underbilling)}`}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>

      {/* Per-project drill-in modal */}
      <Modal visible={drillProjectId !== null} transparent animationType="slide" onRequestClose={closeDrill}>
        <View style={styles.modalOverlay}>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end' }} keyboardShouldPersistTaps="handled">
            <View style={[styles.formCard, { paddingBottom: insets.bottom + 20 }]}>
              <View style={styles.formHeader}>
                <Text style={styles.formTitle}>{drillProject?.name ?? 'Project'}</Text>
                <TouchableOpacity onPress={closeDrill} accessibilityRole="button" accessibilityLabel="Close">
                  <X size={20} color={themeColors.textMuted} strokeWidth={1.75} />
                </TouchableOpacity>
              </View>
              {drillInput && drillOutput ? (
                <>
                  <Text style={styles.muted}>Cost-to-date (subs + materials; add self-performed labor)</Text>
                  <TextInput
                    style={styles.input}
                    keyboardType="numeric"
                    value={drillCostText}
                    onChangeText={setDrillCostText}
                    placeholder="0"
                    placeholderTextColor={themeColors.textMuted}
                    onEndEditing={commitDrillCost}
                  />
                  {/* The way back. A typed figure is the only thing on this
                      schedule the GC can set, and until this line there was
                      nothing telling him how to un-set it — so an override
                      typed by mistake was permanent. */}
                  {drillRow?.override ? (
                    <Text style={styles.muted}>
                      Clear this box to go back to the app&apos;s own figure
                      {' '}({money(drillRow.auto.value)}).
                    </Text>
                  ) : null}
                  <Row label="Revised contract" value={money(drillOutput.revisedContract)} styles={styles} />
                  <Row label="% complete" value={pct(drillOutput.percentComplete)} styles={styles} />
                  <Row label="Earned revenue" value={money(drillOutput.earnedRevenue)} styles={styles} />
                  <Row label="Overbilling" value={money(drillOutput.overbilling)} styles={styles} />
                  <Row label="Underbilling" value={money(drillOutput.underbilling)} styles={styles} />
                  <Row label="Est gross profit" value={money(drillOutput.estGrossProfit)} styles={styles} />
                  <Row label="Est gross margin" value={pct(drillOutput.estGrossMarginPct)} styles={styles} />
                  <Row label="Profit to date" value={money(drillOutput.profitToDate)} styles={styles} />
                  <Row label="Cost to complete" value={money(drillOutput.costToComplete)} styles={styles} />
                  <Row label="Backlog" value={money(drillOutput.backlog)} styles={styles} />

                  {/* Where each number came from. A banker's first question is
                      "what is this contract figure?" and until now the answer
                      lived only in deriveOriginalContract's branch order. */}
                  {drillRow ? (
                    <View style={styles.sourceBox} testID="wip-provenance">
                      <Text style={styles.sourceTitle}>Where these numbers come from</Text>
                      <Text style={styles.sourceLine}>
                        Contract {money(drillInput.originalContract)} —{' '}
                        {WIP_SOURCE_LABELS[drillRow.sources.originalContract]}
                        {/* Deductive change orders are ordinary — the owner
                            cuts scope — and this read "plus $-30,000". Same
                            rule as describeWipRowSources, which writes the
                            exported copy of this same line. */}
                        {drillInput.approvedChangeOrders > 0
                          ? `, plus ${money(drillInput.approvedChangeOrders)} of approved change orders`
                          : drillInput.approvedChangeOrders < 0
                            ? `, less ${money(Math.abs(drillInput.approvedChangeOrders))} of approved deductive change orders`
                            : ''}
                      </Text>
                      <Text style={styles.sourceLine}>
                        Cost budget {money(drillInput.totalEstimatedCost)} —{' '}
                        {WIP_SOURCE_LABELS[drillRow.sources.totalEstimatedCost]}
                      </Text>
                      <Text style={styles.sourceLine}>
                        {drillRow.override
                          ? `Cost-to-date ${money(drillInput.costToDate)} — `
                            + `${wipSourceLabel(drillRow.sources.costToDate)}. `
                            + `The app can only see ${money(drillRow.auto.value)} `
                            + `(${money(drillRow.auto.committed)} subs paid + `
                            + `${money(drillRow.auto.materials)} material receipts).`
                          : `Cost-to-date ${money(drillRow.auto.value)} — `
                            + `${money(drillRow.auto.committed)} subs paid + `
                            + `${money(drillRow.auto.materials)} material receipts. `
                            + 'Self-performed labor is NOT included, so this is a lower bound — type the real figure above.'}
                      </Text>
                      {drillRow.override && !drillRow.override.synced ? (
                        <Text style={styles.sourceLine}>
                          This figure is on this device only so far. It goes up to your account
                          automatically — until it does, WIP on your other devices still shows the
                          subs + materials estimate.
                        </Text>
                      ) : null}
                    </View>
                  ) : null}

                  {drillOutput.anticipatedLoss ? (
                    <View style={styles.flagBox}>
                      <View style={styles.flagRow}>
                        <AlertTriangle size={14} color={themeColors.danger} strokeWidth={2} />
                        <Text style={styles.flagText}>
                          Loss job: the full estimated loss is booked now (GAAP), not pro-rated by % complete.
                        </Text>
                      </View>
                    </View>
                  ) : null}
                  {drillFlags && drillFlags.reasons.length > 0 ? (
                    <View style={styles.flagBox}>
                      {drillFlags.reasons.map((reason) => (
                        <View key={reason} style={styles.flagRow}>
                          <AlertTriangle size={14} color={themeColors.danger} strokeWidth={2} />
                          <Text style={styles.flagText}>{reason}</Text>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </>
              ) : null}
            </View>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

function Row({ label, value, styles }: { label: string; value: string; styles: ReturnType<typeof makeStyles> }) {
  return (
    <View style={styles.dataRow}>
      <Text style={styles.dataLabel}>{label}</Text>
      <Text style={styles.dataValue}>{value}</Text>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  // WIP is a financial table — wide on desktop.
  // Desktop: Portfolio + Periods sit side by side and the Projects table spans
  // the full row, instead of three cards stacked in a narrow middle column.
  contentDesktop: {
    width: '100%', maxWidth: 1400, alignSelf: 'center' as const,
    flexDirection: 'row' as const, flexWrap: 'wrap' as const,
    alignItems: 'flex-start' as const, gap: 16,
  },
  cardDesktop: { flexGrow: 1, flexBasis: 420, marginBottom: 0 },
  cardFullDesktop: { flexBasis: '100%' as const, marginBottom: 0 },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingBottom: 12,
    backgroundColor: t.bg, borderBottomWidth: 1, borderBottomColor: t.line,
  },
  eyebrow: { fontSize: Type.footnote.fontSize, color: t.textMuted, fontWeight: '600' as const },
  title: { fontSize: Type.title2.fontSize, color: t.text, fontWeight: '700' as const },
  card: {
    backgroundColor: t.surface, borderRadius: Tokens.radius.panel, padding: 16,
    marginBottom: 16, borderWidth: 1, borderColor: t.line, gap: 6,
  },
  sectionTitle: { fontSize: Type.subheadline.fontSize, fontWeight: '700' as const, color: t.text, marginBottom: 8 },
  dataRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  dataLabel: { fontSize: Type.bodyCompact.fontSize, color: t.textSecondary },
  dataValue: { fontSize: Type.bodyCompact.fontSize, color: t.text, fontWeight: '600' as const },
  muted: { fontSize: Type.footnote.fontSize, color: t.textMuted },
  projectRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10,
    borderTopWidth: 1, borderTopColor: t.line,
  },
  projectName: { fontSize: Type.bodyCompact.fontSize, color: t.text, fontWeight: '600' as const },
  over: { fontSize: Type.footnote.fontSize, color: t.danger, fontWeight: '700' as const },
  under: { fontSize: Type.footnote.fontSize, color: t.info, fontWeight: '700' as const },
  periodChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: Tokens.radius.md,
    backgroundColor: t.surfaceAlt, borderWidth: 1, borderColor: t.line,
  },
  periodChipActive: { borderColor: t.accent, backgroundColor: t.accentSoft },
  periodChipText: { fontSize: Type.footnote.fontSize, color: t.text, fontWeight: '600' as const },
  actionRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  actionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 10, borderRadius: Tokens.radius.md,
    backgroundColor: t.surfaceAlt, borderWidth: 1, borderColor: t.line,
  },
  actionBtnText: { fontSize: Type.bodyCompact.fontSize, color: t.text, fontWeight: '600' as const },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  formCard: {
    backgroundColor: t.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28,
    padding: 22, gap: 6,
  },
  formHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  formTitle: { fontSize: Type.title3.fontSize, fontWeight: '700' as const, color: t.text },
  input: {
    backgroundColor: t.surfaceAlt, borderRadius: Tokens.radius.md, borderWidth: 1, borderColor: t.line,
    paddingHorizontal: 12, paddingVertical: 10, color: t.text, fontSize: Type.body.fontSize, marginBottom: 8,
  },
  legendRow: { paddingBottom: 8 },
  legendText: { fontSize: Type.footnote.fontSize, color: t.textSecondary, lineHeight: 18 },
  sourceBox: {
    marginTop: 12, padding: 12, gap: 6,
    backgroundColor: t.surfaceAlt, borderRadius: Tokens.radius.md,
    borderWidth: 1, borderColor: t.line,
  },
  sourceTitle: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: t.text },
  sourceLine: { fontSize: Type.footnote.fontSize, color: t.textSecondary, lineHeight: 18 },
  flagBox: { marginTop: 10, gap: 6 },
  flagRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  flagText: { fontSize: Type.footnote.fontSize, color: t.danger, flex: 1 },
});
