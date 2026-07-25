// utils/weatherHistory.ts — aggregate DFR weather into a lost-days-per-month
// table. Pure — no React, no mageAI, no RN. Feeds buildAnswersPrompt so
// schedules buffer for the contractor's real historical weather losses.
//
// Counting rules (pinned by scripts/validate-weather-history.ts):
//  1. A report is weather-LOST only when the LOSS is evidenced — an explicit
//     stoppage phrase ("rained out", "no work due to weather", "weather
//     day") in either field, or non-negated weather/delay language in
//     issuesAndDelays (the field where the GC records delays).
//  2. weather.conditions ALONE never counts. It is auto-filled from the
//     weather API ("Light rain", "Patchy rain possible"), so every rainy
//     calendar day with a full crew working would otherwise register as a
//     lost day.
//  3. Negations don't count: "no rain today", "No weather delays" record
//     the ABSENCE of loss.
//  4. Months are parsed from the ISO date string, not via new Date():
//     'YYYY-MM-DD' parses as UTC midnight while getMonth() is local, so in
//     every US timezone a report dated the 1st would land in the previous
//     month.
//  5. Values are normalized per (year, month) observation: two years of
//     DFRs with 4 rainy Januaries each means ~4 lost days in a typical
//     January — not 8.
import type { DailyFieldReport } from '@/types';

/** Average lost days per calendar month (0 = January) across the years
 *  observed. Values may be fractional (e.g. 4 lost days across two observed
 *  Januaries → 2). */
export type WeatherLostByMonth = Record<number, number>;

/** Phrases that explicitly assert a weather work stoppage — count from
 *  either field, no negation guard needed (the phrase IS the loss). */
const STOPPAGE_PATTERNS = [
  /\brain(?:ed)?[\s-]*out\b/i,
  /\bweather\s+da(?:y|ys)\b/i,
  /\bno\s+work\b[^.;\n]*\b(?:rain|snow|storm|weather|wind|ice)\b/i,
  /\b(?:rain|snow|storm|weather|wind|ice)\b[^.;\n]*\bno\s+work\b/i,
];

/** Weather/delay keywords that count only in issuesAndDelays and only when
 *  not negated. */
const WEATHER_LOSS_PATTERNS = [
  /\brain\b/i, /\bsnow\b/i, /\bblizzard\b/i, /\bice\b/i, /\bfreezing\b/i,
  /\bhurricane\b/i, /\btornado\b/i, /\bhail\b/i, /\bthunder/i, /\blightning/i,
  /\bweather\s+(delay|stop|halt|clos)/i, /\bhigh\s*wind/i,
];

/** True when a negation token sits just before the match ("no rain",
 *  "without snow", "no weather delays today"). Window is small on purpose —
 *  "no work due to rain" must NOT read as a negated "rain" (it's caught by
 *  STOPPAGE_PATTERNS before this guard ever runs). */
const NEGATION_BEFORE = /\b(?:no|not|without|never|zero|didn'?t)\s*$/i;

function hasNonNegatedMatch(text: string, patterns: RegExp[]): boolean {
  for (const p of patterns) {
    // Fresh regex per test — the shared patterns are not /g so lastIndex is
    // not an issue, but exec gives us the match index for the negation look-back.
    const m = p.exec(text);
    if (!m || m.index === undefined) continue;
    const before = text.slice(Math.max(0, m.index - 12), m.index);
    if (NEGATION_BEFORE.test(before)) continue;
    return true;
  }
  return false;
}

function isWeatherLost(report: DailyFieldReport): boolean {
  const conditions = report.weather?.conditions ?? '';
  const issues = report.issuesAndDelays ?? '';
  // Explicit stoppage phrases count from either field.
  if (STOPPAGE_PATTERNS.some(p => p.test(conditions) || p.test(issues))) return true;
  // Otherwise the evidence must be in the delays field, non-negated.
  // conditions alone is API-autofilled ambient weather — never a loss.
  return hasNonNegatedMatch(issues, WEATHER_LOSS_PATTERNS);
}

/** 'YYYY-MM' from an ISO date string, or null when malformed. String parse,
 *  NOT new Date(): see counting rule 4. */
function yearMonthOf(date: string): { ym: string; month: number } | null {
  const m = /^(\d{4})-(\d{2})/.exec(date);
  if (!m) return null;
  const month = Number(m[2]) - 1;
  if (month < 0 || month > 11) return null;
  return { ym: `${m[1]}-${m[2]}`, month };
}

export function computeWeatherHistory(reports: DailyFieldReport[]): WeatherLostByMonth {
  // Per (year, month): how many lost days, and which (year, month) buckets
  // have ANY report (an observation with zero losses still counts in the
  // denominator — a dry January observed is evidence Januaries can be dry).
  const lostByYm = new Map<string, number>();
  const monthOfYm = new Map<string, number>();
  for (const r of reports) {
    if (!r.date) continue;
    const parsed = yearMonthOf(r.date);
    if (!parsed) continue;
    monthOfYm.set(parsed.ym, parsed.month);
    if (isWeatherLost(r)) lostByYm.set(parsed.ym, (lostByYm.get(parsed.ym) ?? 0) + 1);
  }

  // Fold year-months into per-month averages across observed years.
  const totals = new Map<number, { lost: number; observations: number }>();
  for (const [ym, month] of monthOfYm) {
    const t = totals.get(month) ?? { lost: 0, observations: 0 };
    t.lost += lostByYm.get(ym) ?? 0;
    t.observations += 1;
    totals.set(month, t);
  }

  const lost: WeatherLostByMonth = {};
  for (const [month, t] of totals) {
    if (t.lost <= 0 || t.observations <= 0) continue;
    lost[month] = t.lost / t.observations;
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
  if (avg < 1) return null;
  return `Your reports show ~${avg} weather-lost day${avg === 1 ? '' : 's'}/month historically (${months})`;
}
