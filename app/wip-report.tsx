import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, TextInput, Keyboard,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import { Stack, useRouter } from 'expo-router';
import { ChevronLeft, TrendingUp, Lock, FileSpreadsheet, X, AlertTriangle, HelpCircle, CalendarDays } from 'lucide-react-native';
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
  suggestBillingsWithSource, sumApprovedChangeOrders, isWipReportableProject,
  deriveOriginalContractWithSource, deriveEstimatedCostWithSource,
  suggestCostToDateWithSource, WIP_SOURCE_LABELS, wipSourceLabel,
  describeCostBasis, describePortfolioCostBasis, contractVsEstimateNote,
  payAppContractHistoryNote,
  selectWipDisplayPeriod, applyWipEtcEntry,
  normalizeWipEtcMap, wipEtcStorageKey,
  type WipRowSources, type WipSnapshotRowWithSources, type WipPeriodWithSources,
  type WipEstimatedCost, type WipEtcEntry,
} from '@/utils/wip';
import DatePickerModal from '@/components/DatePickerModal';
import { todayCalendarDay, toCalendarDayString } from '@/utils/calendarDate';
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
/** 0..1, NaN-safe — a schedule with a corrupt progress must not poison a flag. */
function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
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

// ── ESTIMATED COST TO COMPLETE ──────────────────────────────────────────────
//
// The input a CPA-prepared WIP is built on and this product did not have
// anywhere (audit 2026-09-11, the top finding in this area). Without it, the
// incurred floor under cost-at-completion makes an overrun job report EXACTLY
// 100% complete, the full contract earned, $0 left to spend and $0 of backlog —
// by construction, on both bank-facing schedules, while the job may be 60%
// built. Surety WIP templates name "the estimated cost to complete, updated by
// the person actually running the job" as a required column.
//
// Tenant-namespaced by user id like the cost overrides beside it, and under the
// `mageid_` prefix so utils/localCacheKeys.ts's tenant sweep covers it without
// a list to maintain.
//
// DEVICE-LOCAL, AND THE SCREEN SAYS SO. The cost-to-date override syncs through
// public.wip_cost_overrides; that table has no column for a cost to complete and
// adding one is a migration this wave does not own. So an ETC typed on the
// laptop is not visible on the phone, and the drill-in states that in words
// rather than letting a GC assume otherwise — the same failure the override
// sync was built to close, and the same disclosure it uses while a write is
// pending. What it is NOT is lost: the ETC is frozen onto the period snapshot,
// and periods DO sync, so the document that leaves the building carries it.
// The key, the entry shape and the parser now live in utils/wip.ts
// (WIP_ETC_STORAGE_PREFIX / WipEtcEntry / normalizeWipEtcMap). They were three
// private helpers here, and that is exactly why the /reports WIP and Profit
// tabs could not see the forecast: a storage key only one screen knows how to
// build is a second definition of the number it holds. app/reports.tsx reads
// the same map through the same three, and computeWIPReport / computeProfit-
// Report take it as a parameter.

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

// A WIP SCHEDULE OF ZEROS IS STILL A BANK DOCUMENT (polish audit 2026-09-10).
// On a brand-new account this screen printed seven zeros in its Portfolio strip
// and offered Save period / Lock / Export CSV / Export PDF underneath — and the
// save alert then said "Lock it to freeze for CPA/bank review". Lock makes a
// period immutable and Export PDF brands it. A surety and a lender read a WIP
// schedule as a sworn statement of position, so an all-zero one must not be
// freezable or exportable at all.
//
// One reason, four call sites, and it names the prerequisite rather than the
// failure — the repo's standing rule that a blocked button says why. Module
// scope so the four useCallbacks do not each have to carry it as a dependency.
const NOTHING_TO_REPORT =
  'A WIP schedule needs at least one active project with a cost-and-markup estimate. '
  + 'There is nothing to freeze or export yet — and a schedule of zeros is a document a '
  + 'bank or a surety would read as your actual position.';

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
    settings,
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
  // Per-project estimated cost to complete. Same hydrate-then-persist shape as
  // the overrides above; no server leg yet (see utils/wip.WIP_ETC_STORAGE_PREFIX).
  const [etcMap, setEtcMap] = useState<Record<string, WipEtcEntry>>({});
  const etcHydratedRef = useRef(false);

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

  // Cost-to-complete: clear on tenant switch, then read this device's map.
  useEffect(() => {
    let cancelled = false;
    etcHydratedRef.current = false;
    setEtcMap({});
    (async () => {
      let loaded: Record<string, WipEtcEntry> = {};
      try {
        const raw = await AsyncStorage.getItem(wipEtcStorageKey(userId));
        if (raw) loaded = normalizeWipEtcMap(JSON.parse(raw));
      } catch { /* fresh install / bad cache → no forecasts on this device */ }
      if (cancelled) return;
      // Anything typed while the read was in flight is NEWER than everything it
      // is carrying — same last-writer hazard the override hydrate guards.
      setEtcMap((typedWhileLoading) => ({ ...loaded, ...typedWhileLoading }));
      etcHydratedRef.current = true;
    })();
    return () => { cancelled = true; };
  }, [userId]);

  useEffect(() => {
    if (!etcHydratedRef.current) return;
    void AsyncStorage.setItem(wipEtcStorageKey(userId), JSON.stringify(etcMap))
      .catch(() => { /* non-fatal cache write */ });
  }, [etcMap, userId]);
  const [drillProjectId, setDrillProjectId] = useState<string | null>(null);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null);
  // Controlled buffer for the drill-in cost-to-date field so a typed-but-not-
  // blurred value is captured on close (uncontrolled defaultValue + onEndEditing
  // silently dropped edits when the user tapped X without dismissing the keyboard).
  const [drillCostText, setDrillCostText] = useState<string>('');
  // Controlled buffer for the cost-to-complete field, same shape and same
  // reason as the cost-to-date one above.
  const [drillEtcText, setDrillEtcText] = useState<string>('');

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
    /** Both cost-at-completion candidates, so the screen can name the basis. */
    cost: WipEstimatedCost;
    /** The GC's own forecast of what is LEFT to spend, when he has entered one. */
    etc: WipEtcEntry | undefined;
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
    // Cost-to-date first: it is the third FLOOR under cost-at-completion, so it
    // has to exist before the derive runs.
    const auto = suggestCostToDateWithSource(commitments, receipts);
    const override = overrideInForce(costOverrides, project.id);
    const costToDate = override ? override.value : auto.value;
    // Pass the CO figures so the COST budget grows with them too. Without
    // this the revenue side gains the change order and the cost side does
    // not, which reports every CO at 100% margin.
    const cost = deriveEstimatedCostWithSource(project, commitments, {
      approvedChangeOrders,
      originalContract: contract.value,
      // The incurred floor — max(estimate, signed commitments, cost paid out).
      // utils/financialReports.ts passes this at BOTH its call sites; this
      // screen was the third and was missed when the floor landed on
      // 2026-09-10, so /reports floored an overrun job at its real cost while
      // /wip-report kept reporting the estimate. Two bank-facing schedules,
      // same job, margins 27 points apart — the exact divergence the floor was
      // added to close, re-created by fixing two call sites out of three.
      costIncurred: costToDate,
      // DELIBERATELY NOT `estimatedCostToComplete` — the one call site in the
      // app that leaves it off. This derivation is what MAGE would forecast on
      // its own, and the drill-in prints it as "MAGE's own figure was X; clear
      // the cost-to-complete box to go back to it". Feeding the ETC in here
      // would make that sentence quote the GC's own number back at him as the
      // alternative to itself. computeWipRow applies the ETC to the row, off
      // the same `isUsableWipEtc` test the derivation uses, so the two can
      // never disagree about whether one was entered.
    });

    // Billed-to-date AND the retainage held inside it, from one branch decision
    // (pay apps or issued invoices) so the two reconcile on the page. Retainage
    // was absent from this schedule entirely — on screen, in the CSV and in the
    // PDF — while the sibling /reports tab carried it.
    const billings = suggestBillingsWithSource(invoices, payApps);
    // A typed cost to complete REPLACES the derived forecast inside
    // computeWipRow. It is the only thing that stops an overrun job reporting
    // 100% complete by construction.
    const etc = etcMap[project.id];

    return {
      input: {
        originalContract: contract.value,
        approvedChangeOrders,
        totalEstimatedCost: cost.value,
        costToDate,
        billedToDate: billings.billedToDate,
        retainageHeld: billings.retainageHeld,
        estimatedCostToComplete: etc?.value,
      },
      sources: {
        originalContract: contract.source,
        // When the GC has said what is left to spend, the cost at completion is
        // HIS forecast, not a derivation — and the Source cell on a bank
        // document must say which. Naming the estimate branch here while the
        // number came from cost-to-date + a typed figure is exactly the class
        // of quiet mislabel the provenance layer exists to prevent.
        totalEstimatedCost: etc ? 'cost_to_complete_entered' : cost.source,
        // A typed figure that has not reached the server yet says so. That is
        // the disclosure the whole finding was missing: the number changed
        // between two devices and nothing told anyone.
        costToDate: override
          ? (override.synced ? 'entered_and_synced' : 'entered_on_this_device')
          : auto.source,
      },
      auto,
      override,
      cost,
      etc,
    };
  }, [costOverrides, etcMap, getChangeOrdersForProject, getCommitmentsForProject, getInvoicesForProject, getAIAPayAppsForProject, getReceiptsForProject]);

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

  // SCHEDULE PERCENT, AS A DIAGNOSTIC — never as a revenue basis.
  //
  // flagWipRow's third argument has existed since the engine shipped and NO
  // caller ever passed it, so `scheduleDivergence` could not fire and its
  // threshold constant was dead. It is the one flag that does not need two
  // locked periods to say something: a job 40% through its cost and 75% through
  // its schedule (or the reverse) is the earliest signal a WIP schedule can
  // give. The other WIP schedule used this same average to RECOGNISE REVENUE
  // when it had no cost data, which is what it must not be used for (axis 7);
  // read as a cross-check against the cost basis, it is exactly right.
  //
  // `progress` is 0-100 on a schedule task; flagWipRow wants 0-1.
  const schedulePercentByProject = useMemo(() => {
    const out = new Map<string, number>();
    for (const p of activeProjects) {
      const tasks = p.schedule?.tasks ?? [];
      if (tasks.length === 0) continue;
      const avg = tasks.reduce((sum, t) => sum + (t.progress ?? 0), 0) / tasks.length;
      out.set(p.id, clampPct(avg / 100));
    }
    return out;
  }, [activeProjects]);

  // The cost basis behind the weighted margin in the hero above. The provenance
  // panel this screen already had is excellent and it is one tap down, inside a
  // per-project modal — so the seven figures a banker actually reads, with two
  // Export buttons under them, carried no source at all (polish audit
  // 2026-09-10). Built from the same buildRow call as the rows, in its own memo
  // so liveRows keeps the exact `const { input, sources } = buildRow(p)` shape
  // scripts/validate-wip-provenance.ts pins.
  // Keyed by projectId, not by position. `liveRows` happens to be
  // activeProjects.map today, so an index lookup lines up — but the moment
  // anyone filters a row out of one list and not the other, a project's row
  // would print another project's signed-commitment total, on the schedule a
  // surety reads. A partial lookup that is only correct while two array lengths
  // agree is exactly the class of bug this campaign keeps finding.
  const costBases = useMemo(
    () => new Map(activeProjects.map((p) => [p.id, buildRow(p).cost] as const)),
    [activeProjects, buildRow],
  );
  const portfolioBases = useMemo(() => [...costBases.values()], [costBases]);

  // ONE NOTION OF "LATEST PERIOD", USED EVERYWHERE (audit 2026-09-11, M8).
  // `priorPeriod` sorted by periodEndDate while `lockTarget` and `handleLock`
  // took `periods[0]` — INSERTION order, which is a cloud list ordered by
  // created_at with local-only offline periods prepended in front of it. Two
  // different answers to "the latest period" in one screen, coinciding only
  // because there was no way to save a period dated anything but today. The
  // period-end picker below makes them diverge, so both read this list now.
  // Tie-break on createdAt so two periods saved for the same period end keep a
  // stable order rather than depending on Array.prototype.sort's stability
  // across a list that was assembled from two sources.
  const periodsByEnd = useMemo(
    () => [...periods].sort((a, b) =>
      b.periodEndDate.localeCompare(a.periodEndDate)
      || b.createdAt.localeCompare(a.createdAt)),
    [periods],
  );

  // Prior locked period, for the profit-fade watch.
  const priorPeriod = useMemo(
    () => periodsByEnd.find((p) => p.lockedAt),
    [periodsByEnd],
  );

  // WHAT THE SCREEN IS ACTUALLY SHOWING (audit 2026-09-11). Tapping a saved or
  // locked period chip changed `selectedPeriodId`, which fed the Export buttons
  // and NOTHING else: the Portfolio strip and the Projects list stayed hardwired
  // to today's live rows. So a GC tapped the locked "2026-03-31" chip, read today's revised
  // contract, today's underbilling and today's weighted margin, pressed Export
  // PDF and mailed March. The document that left was internally consistent and
  // self-labelling — which is why this is not a wrong number on a bank page —
  // but the sender was looking at figures that were not in it.
  //
  // The decision itself is `utils/wip.selectWipDisplayPeriod` rather than three
  // ternaries here, because every guard on this fix was a REGEX over this
  // file's source: setting `viewingFrozen = false` restored the whole defect
  // with all four WIP validators green, since the strings they match were still
  // present. scripts/validate-wip.ts now calls the selector and asserts what it
  // RETURNS.
  const { period: selectedPeriod, rows: displayRows, portfolio: displayPortfolio, viewingFrozen } =
    useMemo(
      () => selectWipDisplayPeriod(selectedPeriodId, periods, liveRows, portfolio),
      [selectedPeriodId, periods, liveRows, portfolio],
    );
  // Fade is measured against the period BEFORE the one on screen, not against
  // the newest locked period in the book — otherwise a frozen March row would
  // be compared to June and flagged for a fade that happened after it.
  const comparisonPeriod = useMemo(() => {
    if (!selectedPeriod) return priorPeriod;
    return periodsByEnd.find((p) =>
      p.id !== selectedPeriod.id
      && (p.periodEndDate < selectedPeriod.periodEndDate
        || (p.periodEndDate === selectedPeriod.periodEndDate && p.createdAt < selectedPeriod.createdAt)));
  }, [selectedPeriod, priorPeriod, periodsByEnd]);

  /**
   * THE FADE FLAGS, FROZEN ONTO THE ROWS A SAVE AND AN EXPORT CARRY (F8 part 2,
   * audit 2026-09-11).
   *
   * Profit fade is the surety's central diagnostic and it reached NO export:
   * `flagWipRow` fired in the list and the reason rendered inside a per-project
   * modal, while `WipSnapshotRow` carried nothing — so the CSV and the PDF a
   * bank actually reads could not answer "has this job faded?" at all.
   * Recomputing at export time would not be the same thing: it would compare
   * today's book against today's prior period, not the comparison the period
   * was struck with. So the flags are attached HERE, once, and travel with the
   * row into the snapshot and into both exports.
   *
   * Built off `liveRows` rather than inside it because the comparison period is
   * derived further down (it depends on which chip is selected), and because
   * scripts/validate-wip-provenance.ts pins liveRows' exact
   * `const { input, sources } = buildRow(p)` shape.
   */
  const liveRowsWithFlags: WipSnapshotRowWithSources[] = useMemo(
    () => liveRows.map((r) => {
      const prior = comparisonPeriod?.rows.find((pr) => pr.projectId === r.projectId)?.output;
      const sched = schedulePercentByProject.get(r.projectId);
      return {
        ...r,
        flags: flagWipRow(r.output, prior, sched == null ? undefined : { schedulePercent: sched }),
      };
    }),
    [liveRows, comparisonPeriod, schedulePercentByProject],
  );

  /**
   * WHAT THE FADE FLAGS ARE MEASURED AGAINST, SAID OUT LOUD (F8 part 1).
   *
   * `flagWipRow` compares this period's margin to a PRIOR period's. With no
   * prior period every fade and billing-swing flag is silently dead — which is
   * every new account, and every GC who has not saved twice — and the screen
   * showed no flags and no explanation, so an empty flag column read as "no
   * fade" rather than "not measured".
   *
   * It also states whether the comparison period is LOCKED. The comparison used
   * to require `lockedAt`; it now takes the period immediately before the one on
   * screen whether or not it is locked, because on a frozen March row the newest
   * locked period in the book can be June and comparing March to June flags a
   * fade that happened after it. An unlocked prior period is a real basis but a
   * softer one — it can still be edited — so the sentence names it rather than
   * letting the reader assume both ends are frozen.
   */
  const fadeBasisNote = useMemo(() => {
    if (!comparisonPeriod) {
      return periods.length === 0
        ? 'Profit fade is not being measured: it compares this period against a saved one, and you '
          + 'have not saved a period yet. Save this one to start the comparison.'
        : 'Profit fade is not being measured on this view: there is no saved period dated before it.';
    }
    return `Profit fade is measured against your ${comparisonPeriod.periodEndDate} period`
      + (comparisonPeriod.lockedAt
        ? `, locked ${comparisonPeriod.lockedAt.slice(0, 10)}.`
        : ' — which is SAVED but not locked, so it can still be edited underneath this comparison.');
  }, [comparisonPeriod, periods.length]);

  const [explainerOpen, setExplainerOpen] = useState(false);

  const drillProject = activeProjects.find((p) => p.id === drillProjectId) ?? null;
  const drillRow = drillProject ? buildRow(drillProject) : null;
  const drillInput = drillRow?.input ?? null;
  const drillOutput = drillInput ? computeWipRow(drillInput) : null;
  const drillPriorRow = priorPeriod?.rows.find((r) => r.projectId === drillProjectId)?.output;
  const drillFlags = drillOutput
    ? flagWipRow(drillOutput, drillPriorRow, (() => {
      const sched = drillProjectId ? schedulePercentByProject.get(drillProjectId) : undefined;
      return sched == null ? undefined : { schedulePercent: sched };
    })())
    : null;
  // A pay-app contract sum well off the estimate is disclosed, never acted on.
  // Computed once — it is a sentence, and the modal re-renders on every
  // keystroke in the two money fields above it.
  const drillContractNote = drillRow && drillInput
    ? contractVsEstimateNote(
      { value: drillInput.originalContract, source: drillRow.sources.originalContract },
      drillProject?.linkedEstimate?.grandTotal ?? drillProject?.estimate?.grandTotal,
    )
    : '';
  /**
   * …and the OTHER disagreement: two saved certificates that do not agree with
   * each other about the original contract sum. The engine takes the LATEST
   * one, because that is the sum most recently certified to the owner — it
   * deliberately does NOT abandon the branch, which an earlier pass did and
   * which knocked $100,000 off a certified contract on an ordinary job (a new
   * application re-reads the sum off the estimate, so any re-price makes two
   * applications disagree). The disagreement is a reason to look at the G702s,
   * so it is said here rather than acted on.
   */
  const drillPayAppNote = drillProjectId
    ? payAppContractHistoryNote(getAIAPayAppsForProject(drillProjectId))
    : '';

  // Open the drill modal and seed the controlled cost buffer from the current
  // (override-or-suggested) cost-to-date so the field starts at the live value.
  const openDrill = useCallback((projectId: string) => {
    const proj = activeProjects.find((p) => p.id === projectId);
    const seeded = proj ? buildInput(proj).costToDate : 0;
    setDrillCostText(String(Math.round(seeded)));
    // The ETC box starts EMPTY unless one has been entered, and the derived
    // figure shows as the placeholder instead. Seeding it with the derivation
    // would turn MAGE's own forecast into "entered by you" the moment the sheet
    // is opened and closed — the exact lie the cost-to-date field was fixed for
    // (a Source cell on a bank document claiming the GC typed a number he never
    // saw).
    const existing = proj ? etcMap[proj.id] : undefined;
    setDrillEtcText(existing ? String(Math.round(existing.value)) : '');
    setDrillProjectId(projectId);
  }, [activeProjects, buildInput, etcMap]);

  /**
   * Commit the typed cost to complete. Idempotent for the same reason
   * commitDrillCost is: it fires on blur AND on close, twice with the same text
   * on a normal close.
   *
   * An EMPTY box means "use MAGE's forecast" and removes the entry — there is
   * no server row to resurrect, so a plain delete is enough here (unlike the
   * cost-to-date override, which needs a tombstone). Typing "0" still records a
   * deliberate zero: a job with nothing left to spend is a real answer, and it
   * is the one that makes percent complete read 100% honestly.
   */
  //
  // The rules live in `utils/wip.applyWipEtcEntry` — a pure reducer the
  // validators call directly — because the only guard on the top finding's
  // entire fix used to be a regex over this file: inserting an early `return`
  // here made the cost-to-complete input record NOTHING with every validator
  // still green.
  const commitDrillEtc = useCallback(() => {
    if (!drillProjectId) return;
    const now = new Date().toISOString();
    setEtcMap((prev) => applyWipEtcEntry(prev, drillProjectId, drillEtcText, now));
  }, [drillProjectId, drillEtcText]);

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
    commitDrillEtc();
    Keyboard.dismiss();
    setDrillProjectId(null);
  }, [commitDrillCost, commitDrillEtc]);

  const hasRows = liveRows.length > 0;

  // A WIP SCHEDULE IS "AS OF" A PERIOD END, AND IT IS PREPARED AFTER IT.
  //
  // This used to stamp `new Date().toISOString().slice(0, 10)` with no picker
  // anywhere, so there was no way to produce a March 31 WIP on April 10 — which
  // is when every monthly close actually happens — and `toISOString()` is UTC,
  // so a save at 5pm Pacific on the 31st dated the period to the 1st of the
  // next month. Both are closed here: the day comes from LOCAL components
  // (utils/calendarDate, which exists because this idiom has bitten this repo
  // repeatedly) and the GC picks it.
  //
  // The default is the one a contractor almost always wants: inside the first
  // two weeks of a month, the close being worked on is the PRIOR month end.
  const defaultPeriodEnd = useCallback((now: Date = new Date()): string => {
    if (now.getDate() <= 14) {
      // Day 0 of this month is the last day of the previous one.
      return toCalendarDayString(new Date(now.getFullYear(), now.getMonth(), 0));
    }
    return todayCalendarDay(now);
  }, []);

  const [periodEndDraft, setPeriodEndDraft] = useState<string>(() => defaultPeriodEnd());
  const [periodDateOpen, setPeriodDateOpen] = useState(false);

  const handleSnapshot = useCallback(() => {
    // Save builds a snapshot from TODAY'S book. With a frozen period on screen
    // it would freeze figures the reader is not looking at, dated a period end
    // whose picker is hidden — the same "the control does something other than
    // what the screen shows" defect this wave is closing one row up.
    if (viewingFrozen) {
      showAlert(
        'You are reading a saved period',
        'Save period snapshots your CURRENT figures. Tap Live first, check the period end, then save.',
      );
      return;
    }
    if (liveRows.length === 0) { showAlert('Nothing to save yet', NOTHING_TO_REPORT); return; }
    const periodEndDate = periodEndDraft;
    const duplicate = periods.find((p) => p.periodEndDate === periodEndDate);
    const save = () => {
      addPeriod({ periodEndDate, rows: liveRowsWithFlags, portfolioTotals: portfolio });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // Was "Lock it to freeze for CPA/bank review." — which recommended bank
      // review of a period the app has not checked. Cost-to-date here is subs
      // paid plus material receipts, a LOWER bound, so the one thing to do
      // before handing it out is top it up with self-performed labour.
      //
      // The second sentence is new and it is the honest one: the figures frozen
      // here are TODAY'S, labelled with the period end you picked. MAGE does
      // not restate history — it has no as-of ledger to restate from — and a
      // schedule dated 3/31 that quietly contains ten days of April cost is the
      // kind of thing a CPA finds later.
      showAlert(
        'Period saved',
        `WIP snapshot dated ${periodEndDate} created. These are your figures AS THEY STAND TODAY, `
        + 'labelled with that period end — MAGE does not restate a closed month, so save the period '
        + 'as close to the date as you can. Check cost-to-date and cost-to-complete on each project '
        + 'before you lock it: the automatic cost figure counts subs paid and material receipts only, '
        + 'so your own crews are not in it yet.',
      );
    };
    if (duplicate) {
      showAlert(
        'Another period already ends there',
        `You already have a ${periodEndDate} snapshot${duplicate.lockedAt ? ', and it is locked' : ''}. `
        + 'Saving a second one leaves two documents claiming the same period end.',
        [{ text: 'Cancel', style: 'cancel' }, { text: 'Save anyway', onPress: save }],
      );
      return;
    }
    save();
  }, [addPeriod, liveRows, liveRowsWithFlags, portfolio, periodEndDraft, periods, viewingFrozen]);

  const handleLock = useCallback(() => {
    const target = selectedPeriodId ? periods.find((p) => p.id === selectedPeriodId) : periodsByEnd[0];
    if (!target) {
      // Two different prerequisites, and sending a GC with no projects to the
      // Save button — which refuses for the same reason — is a loop.
      if (liveRows.length === 0) { showAlert('Nothing to lock', NOTHING_TO_REPORT); return; }
      showAlert('No period', 'Save a period snapshot first, then lock it.');
      return;
    }
    // A period saved before this guard shipped can still be all-zero, and
    // locking is irreversible — so the row count is checked on the PERIOD, not
    // on today's live rows.
    if (target.rows.length === 0) {
      showAlert('Nothing to lock', `This period has no projects on it. ${NOTHING_TO_REPORT}`);
      return;
    }
    if (target.lockedAt) { showAlert('Already locked', 'This period is immutable. Create a new period to make changes.'); return; }
    showAlert('Lock period?', `Locking freezes ${target.periodEndDate}. It can no longer be edited.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Lock', style: 'destructive', onPress: () => { lockPeriod(target.id); void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); } },
    ]);
  }, [selectedPeriodId, periods, periodsByEnd, lockPeriod, liveRows]);

  const exportPeriod = useMemo((): WipPeriodWithSources | null => {
    if (selectedPeriodId) return periods.find((p) => p.id === selectedPeriodId) ?? null;
    // Fall back to a live (unsaved) period shape for export. The period end is
    // the one the GC picked for the save — the export and the snapshot must not
    // be able to disagree about what day this schedule is "as of" — and it is a
    // LOCAL calendar day, never `toISOString()`, which names tomorrow from
    // early evening anywhere west of Greenwich.
    return {
      id: 'live', periodEndDate: periodEndDraft,
      createdAt: new Date().toISOString(), rows: liveRowsWithFlags, portfolioTotals: portfolio,
    };
  }, [selectedPeriodId, periods, liveRowsWithFlags, portfolio, periodEndDraft]);

  // What the two button pairs would actually act on, so their appearance and
  // their behaviour are read off the same thing. `lockTarget` mirrors
  // handleLock's own selection; Live exports the live rows, a chip exports the
  // saved period.
  const lockTarget = selectedPeriodId ? periods.find((p) => p.id === selectedPeriodId) : periodsByEnd[0];
  const canExport = (exportPeriod?.rows.length ?? 0) > 0;

  // LOCK IS BLOCKED FOR ITS OWN REASON, NOT FOR THE EXPORT ONE. This button is
  // dim on any account with no SAVED period — including a healthy one showing a
  // 15% margin — and it first carried NOTHING_TO_REPORT ("needs at least one
  // active project with a cost-and-markup estimate"), which on that account is
  // simply false: he has the project, he has the estimate, he has not saved a
  // period. A dimmed control explained by a reason that does not apply is worse
  // than an unexplained one, because a screen reader reads it out as fact.
  const lockBlockedReason = lockTarget
    ? (lockTarget.rows.length === 0 ? `This period has no projects on it. ${NOTHING_TO_REPORT}` : null)
    // No saved period. On an empty account the prerequisite is the schedule
    // itself, not the snapshot — telling that GC to "save a period first" sends
    // him to a Save button that refuses for the same reason.
    : hasRows
      ? 'Lock freezes a period you have SAVED. Save one first — that is the snapshot your CPA or your bank reads, and locking is what stops it moving underneath them.'
      : NOTHING_TO_REPORT;
  const canLock = lockBlockedReason === null;

  // Every reason in force, deduped and in the order the buttons sit in. The
  // empty-account case produces one line (all four controls share it); a
  // populated account with no saved period produces only Lock's.
  // Save has its own prerequisite too, and while a frozen period is on screen it
  // is not "you have no projects" — it is "you are reading a document".
  const saveBlockedReason = viewingFrozen
    ? 'Save period snapshots your CURRENT figures. Tap Live first, check the period end, then save.'
    : hasRows ? null : NOTHING_TO_REPORT;

  const blockedNotes = [...new Set([
    ...(saveBlockedReason ? [saveBlockedReason] : []),
    ...(lockBlockedReason ? [lockBlockedReason] : []),
    ...(canExport ? [] : [NOTHING_TO_REPORT]),
  ])];

  const handleExportCsv = useCallback(async () => {
    if (!exportPeriod) return;
    if (exportPeriod.rows.length === 0) { showAlert('Nothing to export yet', NOTHING_TO_REPORT); return; }
    // TODAY, so an UNSAVED export dated to a picked period end says on the
    // document that its figures are current-state rather than restated. The
    // Save alert has always said it; Export never passed through the alert.
    const csv = wipPeriodToCSV(exportPeriod, todayCalendarDay());
    const ok = await copyToClipboard(csv);
    if (ok) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    showAlert(ok ? 'CSV copied' : 'Copy failed', ok ? 'Paste into Excel / QuickBooks / Sage.' : 'Could not copy CSV.');
  }, [exportPeriod]);

  const handleExportPdf = useCallback(async () => {
    if (!exportPeriod) return;
    if (exportPeriod.rows.length === 0) { showAlert('Nothing to export yet', NOTHING_TO_REPORT); return; }
    // THE CONTRACTOR'S NAME, NOT THE VENDOR'S. This passed the literal 'MAGE ID',
    // so the H1 of the page a GC emails his banker read "MAGE ID —
    // Work-In-Progress Schedule". A WIP schedule is a statement of the
    // CONTRACTOR's financial position; the software's name on it is the first
    // thing a bonding agent sees and it is the wrong company. app/reports.tsx
    // has always done this correctly and `settings` was one destructure away.
    try { await shareWipPeriodPdf(exportPeriod, settings?.branding?.companyName || 'MAGE ID', todayCalendarDay()); }
    catch { showAlert('Export failed', 'Could not generate the WIP PDF.'); }
  }, [exportPeriod, settings]);

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
          {/* Seven zeros above two Export buttons read as a measured position,
              not as an empty account — and the screen's own "No active
              projects." sat two cards BELOW them, after the reader had already
              taken the headline strip for the answer. */}
          {/* `displayRows`, not `hasRows`: with a frozen period selected the
              card shows THAT period, and a book whose only projects have since
              closed must still be able to render the March schedule it froze. */}
          {/* F8 part 1: an empty flag column used to read as "no fade" when it
              in fact meant "not measured". */}
          <Text style={styles.muted} testID="wip-fade-basis">{fadeBasisNote}</Text>
          {displayRows.length === 0 ? (
            <>
              <Text style={styles.emptyTitle}>{hasRows ? 'Nothing on this period' : 'No active projects'}</Text>
              <Text style={styles.muted}>
                A WIP schedule compares what you have EARNED on each job against what you have
                BILLED for it, so it needs a job to read. To put one on here:
              </Text>
              <Text style={styles.muted}>1  Create a project from the Projects tab.</Text>
              {/* Says what the estimate is FOR, not that it drives every figure
                  here — the contract side comes from a saved pay application, a
                  change-order snapshot, a target budget or a GMP cap long before
                  it falls back to the estimate. Over-claiming on the screen that
                  teaches the schedule is how the schedule stops being believed. */}
              <Text style={styles.muted}>2  Give it an estimate with a cost line and a markup — the cost line is what the margin here is measured against.</Text>
              <Text style={styles.muted}>3  Come back and Save period to snapshot it, then top up cost-to-date with your own crews before you lock it.</Text>
            </>
          ) : (
            <>
              {/* WHAT PERIOD THESE FIGURES ARE. A frozen period and today's live
                  book used to render identically, so the only way to know which
                  you were reading was to remember which chip you had tapped. */}
              {viewingFrozen && selectedPeriod ? (
                <Text style={styles.frozenBanner} testID="wip-frozen-banner">
                  Frozen snapshot — as of {selectedPeriod.periodEndDate}
                  {selectedPeriod.lockedAt
                    ? `, locked ${selectedPeriod.lockedAt.slice(0, 10)} and no longer editable`
                    : ', saved but not locked'}.
                  {' '}These are the figures as they were saved, not today&apos;s. Tap Live for today.
                </Text>
              ) : null}
              <Row label="Revised contract" value={money(displayPortfolio.revisedContract)} styles={styles} />
              <Row label="Earned revenue" value={money(displayPortfolio.earnedRevenue)} styles={styles} />
              <Row label="Billed to date" value={money(displayPortfolio.billedToDate)} styles={styles} />
              <Row label="Overbilling" value={money(displayPortfolio.overbilling)} styles={styles} />
              <Row label="Underbilling" value={money(displayPortfolio.underbilling)} styles={styles} />
              {/* Retainage held is a RECEIVABLE and the most illiquid asset a
                  contractor owns; a surety asks for it separately from ordinary
                  receivables and this schedule did not carry it at all. Absent
                  on a period frozen before it shipped — which reads "not
                  recorded", never $0. */}
              <Row
                label="Retainage held"
                value={displayPortfolio.retainageHeld == null
                  ? 'Not recorded on this period'
                  : money(displayPortfolio.retainageHeld)}
                styles={styles} />
              <Row label="Backlog" value={money(displayPortfolio.backlog)} styles={styles} />
              <Row label="Weighted margin" value={pct(displayPortfolio.weightedMarginPct)} styles={styles} />
              {/* THE WEIGHTED MARGIN NETS. A $200,000 forecast loss beside
                  $200,000 of profit prints 0%, and until now nothing under it
                  said a job was underwater — the only place the app admitted it
                  was inside a per-project drill-in. ASC 605-35-25-46 books the
                  provision per contract and forbids offsetting it against a
                  profitable one, so the headline may not stand alone. */}
              {(displayPortfolio.lossJobCount ?? 0) > 0 ? (
                <Text style={styles.lossLine} testID="wip-loss-provision">
                  {displayPortfolio.lossJobCount} job
                  {displayPortfolio.lossJobCount === 1 ? ' is' : 's are'} forecast to finish at a LOSS,
                  {' '}totalling {money(displayPortfolio.totalForecastLoss ?? 0)}. The margin above nets
                  that against your profitable jobs. Provision to book now:
                  {' '}{money(displayPortfolio.lossProvision ?? 0)} — the part of the loss you have not
                  yet spent. GAAP takes the whole loss in the period it becomes evident.
                </Text>
              ) : null}
              {/* …AND WHAT THE MARGIN COULD NOT MEASURE AT ALL. A job set up
                  with only a target budget or a GMP cap carries a contract and
                  no cost, so it is excluded from BOTH sides of the weighted
                  margin above — and both exports name the exclusion while the
                  one surface a GC actually reads did not. `describeCostBasis`
                  below does say "no cost on file for N jobs", but it does not
                  say the margin above it was measured on a subset, which is the
                  thing a reader has to know before quoting the number. */}
              {(displayPortfolio.noCostBasisCount ?? 0) > 0 ? (
                <Text style={styles.basisLine} testID="wip-no-cost-basis">
                  Measured across {displayRows.length - (displayPortfolio.noCostBasisCount ?? 0)} of
                  {' '}{displayRows.length} jobs. {displayPortfolio.noCostBasisCount} job
                  {displayPortfolio.noCostBasisCount === 1 ? '' : 's'} worth
                  {' '}{money(displayPortfolio.noCostBasisContract ?? 0)} of contract
                  {displayPortfolio.noCostBasisCount === 1 ? ' has' : ' have'} no cost estimate, no
                  signed commitment and nothing spent, so
                  {displayPortfolio.noCostBasisCount === 1 ? ' it has' : ' they have'} no measurable
                  margin and {displayPortfolio.noCostBasisCount === 1 ? 'is' : 'are'} excluded from the
                  figure above.
                </Text>
              ) : null}
              {/* The margin above is the one figure on this screen a lender
                  reads as a verdict, and it never said what cost it was
                  measured against. Same sentence /reports prints, from the same
                  helper, so the two schedules explain themselves identically.
                  A frozen period cannot recompute the candidates — they are not
                  persisted — so it says where its provenance IS, rather than
                  explaining today's book above yesterday's numbers. */}
              <Text style={styles.basisLine} testID="wip-cost-basis">
                {viewingFrozen
                  ? 'Cost basis: recorded per project on this frozen period — it prints beside every '
                    + 'figure on this period\u2019s CSV and PDF export.'
                  : describePortfolioCostBasis(portfolioBases, portfolio.costToDate)}
              </Text>
            </>
          )}
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
            {periodsByEnd.map((p) => (
              <TouchableOpacity key={p.id}
                style={[styles.periodChip, selectedPeriodId === p.id && styles.periodChipActive]}
                onPress={() => setSelectedPeriodId(p.id)}>
                {p.lockedAt ? <Lock size={12} color={themeColors.textMuted} strokeWidth={2} /> : null}
                <Text style={styles.periodChipText}>{p.periodEndDate}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          {/* PERIOD END — pickable, and defaulted to the close a contractor is
              actually working on. Every monthly close happens days after the
              month ends; before this there was no way to produce a March 31 WIP
              on April 10, and the stamp was UTC, so an evening save west of
              Greenwich dated the period to the following month. */}
          {!viewingFrozen ? (
            <TouchableOpacity
              style={styles.periodEndRow}
              onPress={() => setPeriodDateOpen(true)}
              accessibilityRole="button"
              accessibilityLabel={`Period end ${periodEndDraft}. Change it.`}
              testID="wip-period-end"
            >
              <CalendarDays size={14} color={themeColors.textSecondary} strokeWidth={2} />
              <Text style={styles.periodEndText}>
                Period end <Text style={styles.periodEndValue}>{periodEndDraft}</Text> — tap to change
              </Text>
            </TouchableOpacity>
          ) : null}
          {/* All four read as unavailable with nothing on the schedule, the
              note below them carries the reason, and each handler refuses and
              explains as well — so a platform that lets the press through
              cannot produce an all-zero bank document. */}
          <View style={styles.actionRow}>
            <TouchableOpacity
              style={[styles.actionBtn, (!hasRows || viewingFrozen) && styles.actionBtnBlocked]}
              onPress={handleSnapshot}
              accessibilityRole="button"
              accessibilityState={{ disabled: !hasRows || viewingFrozen }}
              accessibilityHint={saveBlockedReason ?? undefined}
            >
              <Text style={styles.actionBtnText}>Save period</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtn, !canLock && styles.actionBtnBlocked]}
              onPress={handleLock}
              accessibilityRole="button"
              accessibilityState={{ disabled: !canLock }}
              accessibilityHint={lockBlockedReason ?? undefined}
            >
              <Lock size={14} color={themeColors.text} strokeWidth={2} />
              <Text style={styles.actionBtnText}>Lock</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.actionRow}>
            <TouchableOpacity
              style={[styles.actionBtn, !canExport && styles.actionBtnBlocked]}
              onPress={handleExportCsv}
              accessibilityRole="button"
              accessibilityState={{ disabled: !canExport }}
              accessibilityHint={!canExport ? NOTHING_TO_REPORT : undefined}
            >
              <FileSpreadsheet size={14} color={themeColors.text} strokeWidth={2} />
              <Text style={styles.actionBtnText}>Export CSV</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtn, !canExport && styles.actionBtnBlocked]}
              onPress={handleExportPdf}
              accessibilityRole="button"
              accessibilityState={{ disabled: !canExport }}
              accessibilityHint={!canExport ? NOTHING_TO_REPORT : undefined}
            >
              <Text style={styles.actionBtnText}>Export PDF</Text>
            </TouchableOpacity>
          </View>
          {/* A blocked button says why, VISIBLY — the repo's own pattern
              (app/cash-flow.tsx:1157). The alert on tap is the belt; a reader
              who never taps, and a screen reader that reads the row as
              disabled, still get the reason. Every reason in force is printed,
              deduped: this used to render only on an empty account, so a
              populated one showed a dimmed Lock with nothing on screen saying
              why it was dim. */}
          {blockedNotes.length > 0 ? (
            <View testID="wip-export-blocked">
              {blockedNotes.map((note) => (
                <Text key={note} style={styles.blockedNote}>{note}</Text>
              ))}
            </View>
          ) : null}
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
          {displayRows.length === 0 ? (
            <Text style={styles.muted}>{viewingFrozen ? 'This period has no projects on it.' : 'No active projects.'}</Text>
          ) : displayRows.map((r) => {
            const prior = comparisonPeriod?.rows.find((pr) => pr.projectId === r.projectId)?.output;
            // The schedule cross-check only means anything against TODAY's
            // schedule, so it is passed for live rows only — a frozen March row
            // compared to June's progress would flag a divergence that did not
            // exist in March.
            const evm = viewingFrozen
              ? undefined
              : (() => {
                const sched = schedulePercentByProject.get(r.projectId);
                return sched == null ? undefined : { schedulePercent: sched };
              })();
            const flags = flagWipRow(r.output, prior, evm);
            const rowCost = viewingFrozen ? undefined : costBases.get(r.projectId);
            // A LOSS JOB IS THE FLAG. `anticipatedLoss` was excluded from this
            // expression, so the one condition the engine treats as an
            // accounting event — the full ASC 605-35 provision — was the one
            // condition the list did not mark, and the only place it appeared
            // was inside a per-project modal the GC reading the list never
            // opens.
            const flagged = r.output.anticipatedLoss
              || flags.profitFade || flags.billingSwing || flags.scheduleDivergence;
            return (
              <TouchableOpacity
                key={r.projectId}
                style={styles.projectRow}
                disabled={viewingFrozen}
                accessibilityRole={viewingFrozen ? undefined : 'button'}
                onPress={() => openDrill(r.projectId)}>
                <View style={{ flex: 1 }}>
                  <View style={styles.projectNameRow}>
                  <Text style={styles.projectName}>{r.projectName}</Text>
                  {r.output.anticipatedLoss ? (
                    <Text style={styles.lossTag} testID="wip-loss-tag">LOSS JOB</Text>
                  ) : null}
                </View>
                  <Text style={styles.muted}>{pct(r.output.percentComplete)} complete · {money(r.output.earnedRevenue)} earned</Text>
                  {/* A cost-to-date that came off another device used to be
                      indistinguishable from one typed here and from the
                      subs+materials estimate. All three read the same, and the
                      GC only found out which he had when the surety asked. */}
                  {/* "$0 · est." called a zero an estimate. Nothing was
                      estimated — nothing has been PAID. On this very account
                      that row sat beside $42,200 of signed subcontracts, so a
                      GC reading it reasonably concluded MAGE had costed his job
                      at zero rather than that no payment had cleared. The
                      branch now reads the VALUE as well as the source. */}
                  <Text style={styles.muted}>
                    Cost-to-date {money(r.input.costToDate)}
                    {r.sources?.costToDate === 'entered_and_synced'
                      ? ' · entered by you, synced'
                      : r.sources?.costToDate === 'entered_on_this_device'
                        ? ' · entered here, not synced yet'
                        : r.input.costToDate > 0
                          ? ' · subs paid + material receipts only — tap to add your own crews'
                          : rowCost && rowCost.committedFloor > 0
                            ? ` — nothing paid out yet, though ${money(rowCost.committedFloor)} is signed. Tap to enter what this job has cost you.`
                            : ' — nothing recorded yet. Tap to enter what this job has cost you.'}
                  </Text>
                </View>
                {flagged ? <AlertTriangle size={16} color={themeColors.danger} strokeWidth={2} /> : null}
                {/* "Under $0" asserted a job was exactly on billing when
                    NOTHING had been billed at all — the ternary branched on
                    overbilling alone, so every unbilled job on a fresh account
                    read as a measurement. An em dash is the honest cell. */}
                <Text style={
                  r.output.overbilling > 0 ? styles.over
                    : r.output.underbilling > 0 ? styles.under : styles.muted
                }>
                  {r.output.overbilling > 0
                    ? `Over ${money(r.output.overbilling)}`
                    : r.output.underbilling > 0
                      ? `Under ${money(r.output.underbilling)}`
                      : '—'}
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

                  {/* ESTIMATED COST TO COMPLETE — the input a CPA-prepared WIP
                      is built on, and the only thing that stops an overrun job
                      reporting 100% complete by construction. With it entered,
                      cost at completion = cost to date + this figure, and
                      percent complete, earned revenue, backlog and margin all
                      follow from a forecast the person running the job made
                      rather than from an estimate that has been overtaken. */}
                  <Text style={styles.muted}>Cost to complete — what is still left to spend on this job</Text>
                  <TextInput
                    style={styles.input}
                    keyboardType="numeric"
                    value={drillEtcText}
                    onChangeText={setDrillEtcText}
                    placeholder={String(Math.round(drillOutput.costToComplete))}
                    placeholderTextColor={themeColors.textMuted}
                    onEndEditing={commitDrillEtc}
                    testID="wip-etc-input"
                  />
                  <Text style={styles.muted}>
                    {drillRow?.etc
                      ? 'Entered by you — cost at completion is your cost-to-date plus this figure. '
                        + 'Clear the box to go back to MAGE\u2019s own forecast. This forecast is saved '
                        + 'on THIS device only; it is frozen into any period you save, and periods do '
                        + 'sync, but your other devices show the derived figure until you re-enter it.'
                      : drillInput.costToDate > drillInput.totalEstimatedCost
                        ? 'This job has already cost MORE than the cost at completion above, so percent '
                          + 'complete reads 100% and backlog reads $0 whatever is actually left to do. '
                          + 'Type what is still left to spend and every figure here is measured against '
                          + 'your forecast instead.'
                        : 'Leave blank and MAGE forecasts it as cost at completion minus cost to date. '
                          + 'A surety asks for this figure by name, updated by whoever is running the job.'}
                  </Text>
                  <Row label="Revised contract" value={money(drillOutput.revisedContract)} styles={styles} />
                  <Row label="% complete" value={pct(drillOutput.percentComplete)} styles={styles} />
                  <Row label="Earned revenue" value={money(drillOutput.earnedRevenue)} styles={styles} />
                  <Row label="Overbilling" value={money(drillOutput.overbilling)} styles={styles} />
                  <Row label="Underbilling" value={money(drillOutput.underbilling)} styles={styles} />
                  <Row
                    label="Cost at completion"
                    value={money(drillOutput.estimatedCostAtCompletion ?? drillInput.totalEstimatedCost)}
                    styles={styles} />
                  <Row label="Est gross profit" value={money(drillOutput.estGrossProfit)} styles={styles} />
                  <Row label="Est gross margin" value={pct(drillOutput.estGrossMarginPct)} styles={styles} />
                  <Row label="Profit to date" value={money(drillOutput.profitToDate)} styles={styles} />
                  <Row label="Cost to complete" value={money(drillOutput.costToComplete)} styles={styles} />
                  <Row label="Backlog" value={money(drillOutput.backlog)} styles={styles} />
                  <Row
                    label="Retainage held by owner"
                    value={drillInput.retainageHeld == null ? 'Not recorded' : money(drillInput.retainageHeld)}
                    styles={styles} />

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
                      {/* A pay-app contract sum that sits well off the estimate
                          is the thing a surety asks about, and the GC could not
                          see it from inside the product. Disclosed, never acted
                          on — a signed contract differing from the estimate that
                          priced it is ordinary. */}
                      {drillContractNote ? (
                        <Text style={styles.sourceLine} testID="wip-contract-conflict">{drillContractNote}</Text>
                      ) : null}
                      {drillPayAppNote ? (
                        <Text style={styles.sourceLine} testID="wip-payapp-history">{drillPayAppNote}</Text>
                      ) : null}
                      <Text style={styles.sourceLine}>
                        Cost budget {money(drillOutput.estimatedCostAtCompletion ?? drillInput.totalEstimatedCost)} —{' '}
                        {WIP_SOURCE_LABELS[drillRow.sources.totalEstimatedCost]}
                      </Text>
                      {/* Which of the two candidates that branch actually was,
                          and what the other one holds. Naming the branch alone
                          still left "why is this $131,502 when I have signed
                          $42,200 of subs" unanswered. */}
                      {/* With a cost to complete entered, the DERIVED basis is no
                          longer what the row was struck against — printing
                          "Cost basis: your estimate's cost before markup,
                          $131,502" beside a margin measured against the GC's own
                          forecast would explain a number the page is not showing.
                          Say what actually drove it, and keep the derivation
                          visible as the figure his forecast replaced. */}
                      <Text style={styles.sourceLine}>
                        {drillRow.etc
                          ? `Cost basis: the ${money(drillInput.costToDate)} this job has cost so far plus `
                            + `the ${money(drillRow.etc.value)} you said is still left to spend — your own `
                            + `forecast for this period. MAGE\u2019s own figure was `
                            + `${money(drillRow.cost.value)}; clear the cost-to-complete box to go back to it.`
                          : describeCostBasis(drillRow.cost, drillInput.costToDate)}
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

      <DatePickerModal
        visible={periodDateOpen}
        value={periodEndDraft}
        title="Period end"
        // A WIP period end is very often in the PAST (the close you are
        // preparing) and occasionally today; a future one is a schedule nobody
        // has lived through yet, so the picker's default past-only range is
        // exactly right here.
        onClose={() => setPeriodDateOpen(false)}
        onChange={(iso) => {
          // The picker returns noon UTC of the picked day, so the leading ten
          // characters ARE that calendar day. Re-deriving it through a local
          // Date would reintroduce the timezone shift this replaced.
          setPeriodEndDraft(iso.slice(0, 10));
          setPeriodDateOpen(false);
        }}
      />
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
  emptyTitle: { fontSize: Type.callout.fontSize, fontWeight: '700' as const, color: t.text, marginBottom: 2 },
  basisLine: {
    fontSize: Type.caption2.fontSize, color: t.textMuted, lineHeight: 16,
    marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: t.line,
  },
  frozenBanner: {
    fontSize: Type.caption2.fontSize, color: t.textSecondary, lineHeight: 16,
    marginBottom: 8, padding: 8, borderRadius: Tokens.radius.sm,
    backgroundColor: t.surfaceAlt, borderWidth: 1, borderColor: t.line,
  },
  lossLine: {
    fontSize: Type.caption2.fontSize, color: t.danger, lineHeight: 16,
    marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: t.line,
  },
  periodEndRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10,
  },
  periodEndText: { fontSize: Type.footnote.fontSize, color: t.textSecondary, flex: 1 },
  periodEndValue: { color: t.text, fontWeight: '700' as const },
  projectNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' as const },
  // A word, not a colour. A bare red triangle is decoded by hue alone, which is
  // the one thing that does not survive a screenshot or a monochrome print —
  // and "loss job" is the single most consequential word on this schedule.
  lossTag: {
    fontSize: Type.caption2.fontSize, fontWeight: '700' as const, color: t.danger,
    borderWidth: 1, borderColor: t.danger, borderRadius: Tokens.radius.sm,
    paddingHorizontal: 4, paddingVertical: 1, overflow: 'hidden' as const,
  },
  // Reads as unavailable; the note below it carries the reason.
  actionBtnBlocked: { opacity: 0.45 },
  blockedNote: { fontSize: Type.caption2.fontSize, color: t.textMuted, lineHeight: 16, marginTop: 8 },
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
