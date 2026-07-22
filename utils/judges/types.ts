// utils/judges/types.ts — JUDGES bid-advisor domain types.
// The engine is pure and deterministic; the AI only phrases these numbers.
import type { CostDatabase } from '@/utils/costDatabase';
import type { CalibrationReport } from '@/utils/estimateCalibration';
import type { MarginRiskScore } from '@/utils/marginRiskScore';

export type Verdict = 'take' | 'hold_firm' | 'walk';
export type ConfidenceLevel = 'low' | 'medium' | 'high';

/** A single scope line the engine prices (from an AI-drafted or existing estimate). */
export interface JudgesLine {
  category: string;
  unit: string;
  quantity: number;
  /** The estimate's own unit price (the "bid" assumption). */
  bidUnit: number;
}

export interface PricedLine {
  category: string;
  unit: string;
  quantity: number;
  bidUnit: number;
  /** lookupRate suggestedRate, or null when there's no history for this trade+unit. */
  learnedUnit: number | null;
  /** What we costed at: learnedUnit ?? bidUnit. */
  usedUnit: number;
  lineTrueCost: number;
  confidence: ConfidenceLevel;
  fromHistory: boolean;
}

export type DriverKind =
  | 'margin' | 'cost_confidence' | 'track_record' | 'capacity' | 'risk' | 'calibration';

export interface BidDriver {
  kind: DriverKind;
  polarity: 'positive' | 'negative';
  weight: number;   // 0..1 normalized contribution to the fit score
  detail: string;   // plain, number-bearing sentence
}

export interface CapacitySummary {
  loadPct: number;          // 0..1 committed load in the window
  bookedSolid: boolean;     // loadPct >= 0.85
  overlappingProjects: number;
}

export interface TypeMarginSummary {
  avgMarginPct: number | null; // null when no closed jobs of this type
  jobCount: number;
}

export interface BidVerdictInput {
  lines: JudgesLine[];
  costDb: CostDatabase;
  /** Target MARGIN fraction (0..1), e.g. 0.20 for 20%. */
  targetMargin: number;
  calibration?: CalibrationReport;
  marginRisk?: MarginRiskScore;
  capacity?: CapacitySummary;
  typeMargin?: TypeMarginSummary;
}

export interface BidVerdict {
  verdict: Verdict;
  fitScore: number;          // 0..100
  trueCost: number;
  recommendedLow: number;
  recommendedHigh: number;
  recommendedMid: number;
  marginAtMid: number;       // 0..1 fraction
  targetMargin: number;
  bidBiasNudge: number;      // fraction the range was raised (>0 = you habitually bid low)
  costConfidence: ConfidenceLevel;
  coveragePct: number;       // share of $ costed from real history
  lines: PricedLine[];
  drivers: BidDriver[];      // ranked by weight, both polarities
  disclaimers: string[];
}
