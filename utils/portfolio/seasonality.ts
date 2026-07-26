// utils/portfolio/seasonality.ts — weather-lost-day seasonality from all DFRs
//
// Wraps computeWeatherHistory (utils/weatherHistory.ts:86) fed ALL daily
// field reports from the ProjectContext portfolio switch.
//
// Honest null contract: months with zero observed lost days are suppressed
// (the plan spec: "suppress months until ≥1 observed lost day").
//
// NOT FEASIBLE v1 (flagged per plan's HONESTY LEDGER):
//   - Revenue seasonality: needs ≥2 years of closedAt data
//   - Crew-aware capacity: no crew model exists
//
// Pure. No React. No network. Never throws.

import type { DailyFieldReport } from '@/types';
import { computeWeatherHistory, type WeatherLostByMonth } from '@/utils/weatherHistory';

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

export interface SeasonalityMonth {
  /** 0 = January … 11 = December */
  month: number;
  label: string;
  avgLostDays: number;
}

export interface SeasonalityResult {
  months: SeasonalityMonth[];
  /** Total observed DFR count across all projects */
  reportCount: number;
  /** True when no months had any weather-lost days */
  noData: boolean;
  /** Infeasibility note for features not built in v1 */
  deferredNote: string;
}

export function buildWeatherSeasonality(allDailyReports: DailyFieldReport[]): SeasonalityResult {
  const history: WeatherLostByMonth = computeWeatherHistory(allDailyReports);

  const months: SeasonalityMonth[] = [];
  for (const [monthStr, avgLost] of Object.entries(history)) {
    const month = Number(monthStr);
    if (!Number.isFinite(month) || month < 0 || month > 11) continue;
    if (avgLost <= 0) continue; // suppress zero-loss months
    months.push({
      month,
      label: MONTH_NAMES[month] ?? `Month ${month + 1}`,
      avgLostDays: avgLost,
    });
  }

  // Sort by month order for display
  months.sort((a, b) => a.month - b.month);

  return {
    months,
    reportCount: allDailyReports.length,
    noData: months.length === 0,
    deferredNote:
      'Revenue seasonality (needs ≥2 years of close dates) and crew-aware capacity deferred to v1.1.',
  };
}
