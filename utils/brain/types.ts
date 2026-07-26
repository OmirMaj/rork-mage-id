export type PredictionKind =
  | 'pace_suggestion_applied'
  | 'delay_ripple_applied'
  | 'leak_flag'
  | 'estimate_confidence_snapshot'
  | 'judges_verdict'
  | 'instant_bid_sent'
  | 'bid_score'
  | 'leveling_adjustment';

// Per-kind payload interfaces (one per kind):
export interface PaceSuggestionAppliedPayload {
  taskId: string;
  trade: string;
  aiOriginalDays: number;
  paceDays: number;
  jobCount: number;
  confidence: 'medium' | 'high';
  /** F4 (Friday Close): true when the duration was PRE-APPLIED by the earned
   *  autonomy gate rather than a manual chip tap. Recorded at accept() only
   *  for surviving pre-applies (D4) — payload-only extension, no new kind
   *  (G14). Absent = manual chip tap (existing behavior). */
  preApplied?: boolean;
}

export interface DelayRippleAppliedPayload {
  reportId: string;
  hits: Array<{ taskId: string; deltaDays: number }>;
  predictedFinishDay: number;
}

export interface LeakFlagPayload {
  reportId: string;
  items: Array<{ category: string; description: string; estPrice?: number | null }>;
}

export interface EstimateConfidenceSnapshotPayload {
  estimateId: string;
  grandTotal: number;
  lines: Array<{ id: string; category: string; total: number; confidenceBand: string }>;
  coveragePct: number;
}

export interface JudgesVerdictPayload {
  mode: 'describe' | 'pick';
  verdict: string;
  targetMarginPct: number;
  flagCount: number;
  estimateTotal: number;
  projectId?: string;
}

export interface InstantBidSentPayload {
  responseId: string;
  basis: string;
  groundingRateCount: number;
  tierAmounts: unknown;
}

export interface BidScorePayload {
  bidId: string;
  matchScore: number;
  estimatedWinProbability: number | null;
  decidedCount: number;
}

export interface LevelingAdjustmentPayload {
  // v1 documented but not captured — placeholder
  [key: string]: unknown;
}

// The row shape we INSERT into brain_predictions (no user_id — server fills via auth.uid() default)
export interface BrainPredictionRow {
  id: string;
  project_id?: string | null;
  kind: PredictionKind;
  subject_id: string;
  payload: Record<string, unknown>;
  predicted_at: string; // ISO
}

// The row shape we READ back from brain_predictions (includes server-set fields)
export interface BrainPredictionReadRow extends BrainPredictionRow {
  user_id: string;
  resolved_at: string | null;
  outcome: Record<string, unknown> | null;
}
