// utils/weatherHistory.ts — aggregate DFR weather into a lost-days-per-month
// table. Pure — no React, no mageAI, no RN. Feeds buildAnswersPrompt so
// schedules buffer for the contractor's real historical weather losses.
import type { DailyFieldReport } from '@/types';

/** Lost days per calendar month (0 = January). */
export type WeatherLostByMonth = Record<number, number>;

/** Keywords in DFRWeather.conditions or issuesAndDelays that indicate a
 *  weather-caused work stoppage / significant delay. */
const WEATHER_LOSS_PATTERNS = [
  /\brain\b/i, /\bsnow\b/i, /\bblizzard\b/i, /\bice\b/i, /\bfreezing\b/i,
  /\bhurricane\b/i, /\btornado\b/i, /\bhail\b/i, /\bthunder/i, /\blightning/i,
  /\bweather\s+(delay|stop|halt|clos)/i, /\bhigh\s*wind/i,
  /\bno\s*work.*weather/i, /\bweather.*no\s*work/i,
];

function isWeatherLost(report: DailyFieldReport): boolean {
  const conditions = (report.weather?.conditions ?? '').toLowerCase();
  const issues = (report.issuesAndDelays ?? '').toLowerCase();
  return WEATHER_LOSS_PATTERNS.some(p => p.test(conditions) || p.test(issues));
}

export function computeWeatherHistory(reports: DailyFieldReport[]): WeatherLostByMonth {
  const lost: WeatherLostByMonth = {};
  for (const r of reports) {
    if (!r.date || !isWeatherLost(r)) continue;
    const month = new Date(r.date).getMonth(); // 0–11
    lost[month] = (lost[month] ?? 0) + 1;
  }
  return lost;
}

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/** Produce a one-line fact for prompt injection, or null if no data. */
export function weatherHistoryFactLine(
  lost: WeatherLostByMonth,
  startMonth?: number,   // 0-11; if provided, show the 3-month window around it
): string | null {
  const entries = Object.entries(lost).map(([m, n]) => ({ month: Number(m), days: n }));
  if (entries.length === 0) return null;

  // If start month given, prefer that window; otherwise summarise the top months
  const relevant = startMonth !== undefined
    ? entries.filter(e => {
        // 3-month window: startMonth-1, startMonth, startMonth+1
        const diff = Math.abs(((e.month - startMonth) % 12 + 12) % 12);
        return diff <= 1 || diff >= 11;
      })
    : entries;

  if (relevant.length === 0) return null;
  const totalDays = relevant.reduce((sum, e) => sum + e.days, 0);
  const months = relevant.map(e => MONTH_NAMES[e.month]).join('–');
  const avg = Math.round(totalDays / relevant.length);
  return `Your reports show ~${avg} weather-lost day${avg === 1 ? '' : 's'}/month historically (${months})`;
}
