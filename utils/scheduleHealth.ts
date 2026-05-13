// utils/scheduleHealth.ts — Phase 27.
//
// Single rule for "is this project on track?". Used by the header
// status pill and (later) Dashboard health-score deltas.
//
// Thresholds chosen to feel honest, not gameable:
//   - any overdue task OR critical-path slip > 7d → late
//   - critical-path slip > 2d OR healthScore < 70 → at_risk
//   - else → on_track
//
// Tunable post-launch from user feedback.

export type PillStatus = 'on_track' | 'at_risk' | 'late';

export interface PillInputs {
  /** Days the current critical path is longer than the baseline.
   *  0 = on baseline, positive = slipping. Negative = ahead. */
  cpmSlipDays: number;
  /** How many tasks have a finish date in the past + are not done. */
  overdueCount: number;
  /** Existing 0-100 score from schedule.healthScore. */
  healthScore: number;
}

export function computePillStatus(inp: PillInputs): PillStatus {
  if (inp.overdueCount > 0 || inp.cpmSlipDays > 7) return 'late';
  if (inp.cpmSlipDays > 2 || inp.healthScore < 70)  return 'at_risk';
  return 'on_track';
}

const PILL_LABELS: Record<PillStatus, string> = {
  on_track: 'On Track',
  at_risk:  'At Risk',
  late:     'Late',
};

export function pillLabel(s: PillStatus): string {
  return PILL_LABELS[s];
}
