// hooks/useFieldDayPack — warm the day's plan sheets while there is still
// signal, and tell the truth about what is on the device.
//
// Split in two on purpose, because the two jobs have different owners:
//
//   useFieldDayPackWarmer(projects, planSheets)  mounted ONCE, from
//                                                contexts/ProjectContext, which
//                                                is where the data lives.
//   useFieldDayPack()                            read-only; any surface can
//                                                call it to render coverage.
//
// Keeping the reader free of ProjectContext is what stops an import cycle
// (ProjectContext → warmer → ProjectContext) and lets a presentational card
// like components/summary/TodayOnSite state its own staleness without its
// parent passing a prop down.
//
// Everything about WHAT gets cached, the budget, eviction and the wording is in
// utils/fieldDayPackCore.ts, including the note on what is already offline
// (projects, punch items, subs and contacts all persist through the contexts'
// write-through caches) and therefore is not this hook's job.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform, type AppStateStatus } from 'react-native';
import type { PlanSheet, Project } from '@/types';
import { computeTodayTasks } from '@/utils/summaryBriefing';
import { currentSessionUserId } from '@/utils/offlineQueue';
import {
  readDayPackRecord,
  pruneDayPackRecord,
  warmFieldDayPack,
} from '@/utils/planPrefetch';
import {
  DAY_PACK_HORIZON_DAYS,
  MAX_DAY_PACK_PROJECTS,
  dayPackFreshness,
  describeDayPack,
  rankDayPackProjects,
  shouldWarmNow,
  type DayPackCandidate,
  type DayPackFreshness,
  type DayPackRecord,
} from '@/utils/fieldDayPackCore';

const MS_DAY = 24 * 60 * 60 * 1000;

/**
 * Whether a day pack means anything on this platform.
 *
 * The pack saves sheets as files in the app's documents directory
 * (utils/planSheetLocalFiles, audit #80); the web build has no such directory
 * and no disk guarantee to stand behind the words "Saved for offline". Rather
 * than hold a weaker claim, the web build warms nothing and states nothing —
 * an absent line is honest, a borrowed one is not.
 */
export const DAY_PACK_PLATFORM_SUPPORTED = Platform.OS !== 'web';

/** Re-evaluate the record on this cadence so a pack that crosses the stale or
 *  expiry line stops claiming coverage without the user navigating. */
const RECHECK_INTERVAL_MS = 5 * 60 * 1000;

/** Project ids with at least one scheduled task active on the pack's horizon,
 *  today's band first. Uses computeTodayTasks — the SAME day math the
 *  "TODAY ON SITE" card uses — so the pack covers exactly the jobs that card
 *  names, rather than a second, quietly different idea of "today". */
export function dayPackProjectIds(projects: Project[], now: Date = new Date()): string[] {
  const bands: string[][] = [];
  for (let d = 0; d < DAY_PACK_HORIZON_DAYS; d++) {
    const at = new Date(now.getTime() + d * MS_DAY);
    bands.push(computeTodayTasks(projects, at).map((t) => t.projectId));
  }
  return rankDayPackProjects(bands[0] ?? [], bands.slice(1).flat(), MAX_DAY_PACK_PROJECTS);
}

/** Turn the ranked ids into candidates. Sheet order matches
 *  ProjectContext.getPlanSheetsForProject (most recently updated first), which
 *  is the order the user sees and therefore the order they are likeliest to
 *  open. */
export function buildDayPackCandidates(
  projectIds: readonly string[],
  projects: Project[],
  planSheets: PlanSheet[],
): DayPackCandidate[] {
  const byId = new Map(projects.map((p) => [p.id, p]));
  return projectIds.flatMap((id) => {
    const p = byId.get(id);
    if (!p) return [];
    const sheets = planSheets
      // A superseded revision is not what he builds from today — spending the
      // pack's budget on it would leave a current sheet unsaved.
      .filter((s) => s.projectId === id && !s.superseded)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    if (sheets.length === 0) return [];
    return [{ projectId: id, projectName: p.name, sheetUris: sheets.map((s) => s.imageUri) }];
  });
}

/**
 * Mount ONCE. Warms on first foreground and on every wake, subject to
 * shouldWarmNow's spacing.
 *
 * There is no wifi/cellular signal available to this app (no NetInfo, no
 * expo-network in package.json), so the warm cannot be deferred to wifi. That
 * is why the budget in fieldDayPackCore is sized for a metered connection and
 * why the spacing is three hours.
 *
 * NATIVE ONLY — see DAY_PACK_PLATFORM_SUPPORTED. The copy this warm produces
 * says "Saved for offline", which is true only where the sheets land as files
 * the viewer renders; the web has nowhere to put them.
 */
export function useFieldDayPackWarmer(projects: Project[], planSheets: PlanSheet[]): void {
  // Read through refs so a re-render of ProjectContext (which happens on every
  // local edit) cannot restart the effect and re-warm.
  const projectsRef = useRef(projects);
  const sheetsRef = useRef(planSheets);
  projectsRef.current = projects;
  sheetsRef.current = planSheets;
  const runningRef = useRef(false);

  const maybeWarm = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    try {
      if (!DAY_PACK_PLATFORM_SUPPORTED) return;
      const userId = await currentSessionUserId();
      if (!userId) return;

      const ids = dayPackProjectIds(projectsRef.current);
      // Retract coverage for jobs that have left the horizon BEFORE deciding
      // whether to warm, so a record kept alive only by yesterday's jobs cannot
      // suppress today's warm through the spacing check.
      const pruned = await pruneDayPackRecord(ids);
      if (ids.length === 0) return;
      if (!shouldWarmNow(pruned, Date.now(), userId)) return;

      const candidates = buildDayPackCandidates(ids, projectsRef.current, sheetsRef.current);
      if (candidates.length === 0) return;
      await warmFieldDayPack(userId, candidates);
    } catch (err) {
      // A failed warm is an optimisation that did not happen; it must never
      // surface to the field user as an error.
      console.log('[fieldDayPack] warm skipped:', (err as Error)?.message);
    } finally {
      runningRef.current = false;
    }
  }, []);

  useEffect(() => {
    void maybeWarm();
    const sub = AppState.addEventListener('change', (n: AppStateStatus) => {
      if (n === 'active') void maybeWarm();
    });
    return () => { sub.remove(); };
  }, [maybeWarm]);
}

export interface FieldDayPackView {
  record: DayPackRecord | null;
  freshness: DayPackFreshness;
  /** True only while the pack may still be believed. */
  covered: boolean;
  /**
   * One line of copy that is true right now, or '' when there is nothing we
   * are entitled to say yet — the disk read has not come back, or the platform
   * has no offline guarantee to describe. A caller must render NOTHING for '',
   * not a placeholder: "No plan sheets saved on this device" shown for a
   * quarter of a second before the record loads is a false alarm about the one
   * thing this card exists to reassure the user about.
   */
  summary: string;
  /** True until the first read of the record resolves. */
  loading: boolean;
}

/**
 * Read-only view of the pack, for any surface that wants to state coverage.
 *
 * `jobsToday` is the number of jobs the CALLING surface is showing for today.
 * It is the denominator of the coverage claim: without it, "4 sheets across 1
 * job" is a true sentence that reads as full coverage on a two-job day.
 */
export function useFieldDayPack(jobsToday: number = 0): FieldDayPackView {
  const [record, setRecord] = useState<DayPackRecord | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(DAY_PACK_PLATFORM_SUPPORTED);
  const [tick, setTick] = useState(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    if (!DAY_PACK_PLATFORM_SUPPORTED) return;
    const load = async () => {
      const [rec, uid] = await Promise.all([readDayPackRecord(), currentSessionUserId()]);
      if (!mountedRef.current) return;
      setRecord(rec);
      setUserId(uid);
      setLoading(false);
    };
    void load();
    const interval = setInterval(() => {
      setTick((n) => n + 1);
      void load();
    }, RECHECK_INTERVAL_MS);
    const sub = AppState.addEventListener('change', (n: AppStateStatus) => {
      if (n === 'active') void load();
    });
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
      sub.remove();
    };
  }, []);

  return useMemo(() => {
    // `tick` is a dependency on purpose: freshness is a function of the clock,
    // so the memo must recompute when the clock has moved even if the record
    // on disk is byte-identical.
    void tick;
    const freshness = dayPackFreshness(record, Date.now(), userId);
    const quiet = !DAY_PACK_PLATFORM_SUPPORTED || loading;
    return {
      record,
      freshness,
      covered: !quiet && (freshness === 'fresh' || freshness === 'stale'),
      // Silent until we have actually looked, and on a platform where the
      // sentence would not be true. See FieldDayPackView.summary.
      summary: quiet ? '' : describeDayPack(record, freshness, jobsToday),
      loading,
    };
  }, [record, userId, tick, loading, jobsToday]);
}
