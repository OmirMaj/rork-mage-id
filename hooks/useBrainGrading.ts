// hooks/useBrainGrading.ts
//
// The ONLY impure piece of the Wave 2 grading system.
// Runs once per app session (module-level flag) to grade open predictions.
// Also exposes gradeNow(projectId?) for event-triggered grading:
//   - CO approval hook in ProjectContext calls gradeNow(projectId) for leak flags
//   - close-project flow calls gradeNow(projectId) for full-project grade
//
// Mounted inside BrainWatchCard (already on home with data hooks).
// G4: all resolve calls are fire-and-forget, never blocking.

import { useEffect, useRef, useCallback, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchOpenPredictionsDeduped, resolvePrediction } from '@/utils/brain/predictionLedger';
import { computeResolvableOutcomes } from '@/utils/brain/resolveOutcomes';
import { registerGradingHandler } from '@/utils/brain/gradingBus';
import { buildAccuracyReport, type AccuracyReport } from '@/utils/brain/accuracyReport';
import type { GradingCtx, TrackedBidRecord } from '@/utils/brain/gradePredictions';
import type { BrainPredictionReadRow } from '@/utils/brain/types';
import { useCoreData, useFinancialsData } from '@/contexts/ProjectContext';
import { useBidResponsesPortfolio } from '@/hooks/useBidResponsesPortfolio';
import type { HomeownerBidResponse } from '@/types';

const TRACKED_BIDS_KEY = 'mageid_tracked_bids';

// Module-level flag: only run the lazy sweep once per app session
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

      // Build resolved rows for accuracy report (fetch all resolved rows for this user)
      // We approximate: mark the newly resolved rows locally and add to state
      if (outcomes.length > 0) {
        const nowIso = new Date().toISOString();
        const justResolved = openRows
          .filter(r => outcomes.some(o => o.id === r.id))
          .map(r => ({
            ...r,
            resolved_at: nowIso,
            outcome: outcomes.find(o => o.id === r.id)?.outcome ?? null,
          }));
        setResolvedRows(prev => {
          const merged = [...prev];
          for (const row of justResolved) {
            const existing = merged.findIndex(r => r.id === row.id);
            if (existing >= 0) merged[existing] = row;
            else merged.push(row);
          }
          const report = buildAccuracyReport(merged);
          setAccuracyReport(report);
          return merged;
        });
      }
    } catch {
      // G4: grading failure must never crash the caller
    }
  }, []);

  // Once-per-session lazy sweep
  useEffect(() => {
    if (sessionSweptRef) return;
    sessionSweptRef = true;
    void runGrading();
  }, [runGrading]);

  const gradeNow = useCallback((projectId?: string) => {
    void runGrading(projectId);
  }, [runGrading]);

  // Register this component as the active grader so ProjectContext can call us
  useEffect(() => {
    registerGradingHandler(gradeNow);
  }, [gradeNow]);

  return { resolvedRows, accuracyReport, gradeNow };
}
