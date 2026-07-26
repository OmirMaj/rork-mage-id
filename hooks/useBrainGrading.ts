// hooks/useBrainGrading.ts
//
// The ONLY impure piece of the Wave 2 grading system.
// Runs once per app session (module-level flag) to grade open predictions.
// Also exposes gradeNow(projectId?) for event-triggered grading:
//   - CO approval hook in ProjectContext calls gradeNow(projectId) for leak flags
//   - close-project flow calls gradeNow(projectId) for full-project grade
//
// Mounted inside BrainWatchCard (already on home with data hooks) AND
// cost-database. Each mounted instance loads the RESOLVED HISTORY itself
// (fetchResolvedPredictions) — accuracy must reflect every graded row ever,
// not just rows resolved in this session by this instance (tribunal fix:
// the accuracy surface was empty in every session that didn't happen to
// resolve something new).
//
// G4: all resolve calls are fire-and-forget, never blocking.

import { useEffect, useRef, useCallback, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  fetchOpenPredictionsDeduped, fetchResolvedPredictions, resolvePrediction,
} from '@/utils/brain/predictionLedger';
import { computeResolvableOutcomes } from '@/utils/brain/resolveOutcomes';
import { registerGradingHandler } from '@/utils/brain/gradingBus';
import { buildAccuracyReport, type AccuracyReport } from '@/utils/brain/accuracyReport';
import type { GradingCtx, TrackedBidRecord } from '@/utils/brain/gradePredictions';
import type { BrainPredictionReadRow } from '@/utils/brain/types';
import { useCoreData, useFinancialsData } from '@/contexts/ProjectContext';
import { useBidResponsesPortfolio } from '@/hooks/useBidResponsesPortfolio';
import type { HomeownerBidResponse } from '@/types';

const TRACKED_BIDS_KEY = 'mageid_tracked_bids';

// Module-level flag: only run the lazy WRITE sweep once per app session.
// (The per-instance history READ below is not gated by this — every mount
// loads resolved history for its own accuracy state.)
let sessionSweptRef = false;

function safeJsonParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

interface UseBrainGradingResult {
  /** Full resolved rows — pass to buildAccuracyReport to render accuracy section */
  resolvedRows: BrainPredictionReadRow[];
  accuracyReport: AccuracyReport;
  /** Trigger an immediate grade for one project (CO-approval + close-project hooks) */
  gradeNow: (projectId?: string) => void;
}

export function useBrainGrading(): UseBrainGradingResult {
  const { projects } = useCoreData();
  const { changeOrders, commitments } = useFinancialsData();
  // Wave 3 fix: wire bid_responses so gradeInstantBid can resolve
  const { bidResponses } = useBidResponsesPortfolio();

  const [resolvedRows, setResolvedRows] = useState<BrainPredictionReadRow[]>([]);
  const [accuracyReport, setAccuracyReport] = useState<AccuracyReport>({
    rows: [],
    totalGraded: 0,
    hasEnoughData: false,
  });

  // Stable refs so gradeNow can be called outside the effect
  const projectsRef = useRef(projects);
  const changeOrdersRef = useRef(changeOrders);
  const commitmentsRef = useRef(commitments);
  const bidResponsesRef = useRef(bidResponses);
  projectsRef.current = projects;
  changeOrdersRef.current = changeOrders;
  commitmentsRef.current = commitments;
  bidResponsesRef.current = bidResponses;

  // Mirror of resolvedRows for merging outside React's updater (no
  // setState-inside-setState, which double-fires under StrictMode).
  const resolvedRowsRef = useRef<BrainPredictionReadRow[]>([]);

  /** Merge new rows over what this instance already holds (by id, newest
   *  wins) and refresh both state values. */
  const mergeResolved = useCallback((incoming: BrainPredictionReadRow[]) => {
    if (incoming.length === 0 && resolvedRowsRef.current.length === 0) return;
    const byId = new Map<string, BrainPredictionReadRow>();
    for (const row of resolvedRowsRef.current) byId.set(row.id, row);
    for (const row of incoming) byId.set(row.id, row);
    const merged = [...byId.values()];
    resolvedRowsRef.current = merged;
    setResolvedRows(merged);
    setAccuracyReport(buildAccuracyReport(merged));
  }, []);

  // Per-instance history load: resolved rows graded in ANY session feed this
  // surface's accuracy report, so cost-database shows history on every
  // mount — not only after something new happened to resolve here.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const historical = await fetchResolvedPredictions();
        if (!cancelled && historical.length > 0) mergeResolved(historical);
      } catch {
        // G4: history load failure degrades to session-only accuracy
      }
    })();
    return () => { cancelled = true; };
  }, [mergeResolved]);

  const runGrading = useCallback(async (projectId?: string) => {
    try {
      // Load tracked bids from AsyncStorage
      const raw = await AsyncStorage.getItem(TRACKED_BIDS_KEY);
      const trackedBids = safeJsonParse<TrackedBidRecord[]>(raw, []);

      // Wave 3: bid_responses now wired via useBidResponsesPortfolio
      const bidResponsesForCtx: HomeownerBidResponse[] = bidResponsesRef.current;

      const ctx: GradingCtx = {
        projects: projectsRef.current,
        changeOrders: changeOrdersRef.current,
        commitments: commitmentsRef.current,
        bidResponses: bidResponsesForCtx.length > 0 ? bidResponsesForCtx : undefined,
        trackedBids,
      };

      const openRows = await fetchOpenPredictionsDeduped(undefined, projectId ?? null);
      const outcomes = computeResolvableOutcomes(openRows, ctx);

      // Fire-and-forget resolve each — G4
      for (const { id, outcome } of outcomes) {
        resolvePrediction(id, outcome);
      }

      // Fold the just-resolved rows into this instance's accuracy state.
      // (The server write above is queued/async, so a re-fetch wouldn't see
      // them yet — mark them locally.)
      if (outcomes.length > 0) {
        const nowIso = new Date().toISOString();
        const justResolved = openRows
          .filter(r => outcomes.some(o => o.id === r.id))
          .map(r => ({
            ...r,
            resolved_at: nowIso,
            outcome: outcomes.find(o => o.id === r.id)?.outcome ?? null,
          }));
        mergeResolved(justResolved);
      }
    } catch {
      // G4: grading failure must never crash the caller
    }
  }, [mergeResolved]);

  // Once-per-session lazy sweep — but never on an EMPTY-data run. Contexts
  // hydrate async; sweeping before projects arrive graded nothing yet still
  // locked the session flag, so the pipeline effectively never ran (tribunal
  // fix). Keying on projects.length re-arms the sweep when hydration lands.
  useEffect(() => {
    if (sessionSweptRef) return;
    if (projects.length === 0) return;
    sessionSweptRef = true;
    void runGrading();
  }, [runGrading, projects.length]);

  const gradeNow = useCallback((projectId?: string) => {
    void runGrading(projectId);
  }, [runGrading]);

  // Register this component as the active grader so ProjectContext can call us
  useEffect(() => {
    registerGradingHandler(gradeNow);
  }, [gradeNow]);

  return { resolvedRows, accuracyReport, gradeNow };
}
