// utils/weatherProvenance.ts — where a weather reading came from.
//
// WHY THIS EXISTS: weather-driven reschedules write entries into
// ProjectSchedule.weatherDelayLog — the record a GC later hands an owner to
// justify a delay. Before this module, that log could not distinguish a real
// OpenWeather reading from `getSimulatedForecast()`'s seeded pseudo-random
// invention, and the UI labelled neither. Fiction was being written into the
// delay log.
//
// Every DayForecast now carries a `source`, and it travels with the day
// through the reschedule math into the log entry. Simulated days are
// unmistakable at every layer:
//   • weatherService  — stamps 'live' on OpenWeather days, 'simulated' on
//                       generated ones (including the padded tail past the
//                       free tier's 5-day horizon)
//   • LookaheadView   — renders SIMULATED_WEATHER_HEADLINE whenever any
//                       displayed day is not live
//   • weatherReschedule — refuses to build a delay-log entry with no live
//                       evidence, and stamps 'mixed' when only part is real
//
// Pure: no React, no react-native, no imports. Safe for bun validators.
// Structural params (not `DayForecast`) so weatherService can import this
// without a cycle.

/** Where a single day's reading came from. */
export type ForecastSource =
  /** A real reading fetched from the OpenWeather API. */
  | 'live'
  /** Invented by getSimulatedForecast() — seeded pseudo-random, seasonal
   *  only, with NO relation to the jobsite. Never evidence. */
  | 'simulated';

/** Provenance of a whole forecast window (or of a set of delay dates). */
export type ForecastCoverage = 'live' | 'mixed' | 'simulated' | 'empty';

/** The single env var that turns live weather on. Referenced by the UI copy
 *  and by utils/weatherService.ts getApiKey(). */
export const WEATHER_API_KEY_ENV = 'EXPO_PUBLIC_OPENWEATHER_API_KEY';

/** Unmissable headline for the in-app marker. Deliberately shouty — a
 *  contractor must never mistake invented weather for a forecast. */
export const SIMULATED_WEATHER_HEADLINE = 'SIMULATED WEATHER — NOT A FORECAST';

/** Body copy under the headline. Says what it is, and what to do about it. */
export const SIMULATED_WEATHER_BODY =
  'These conditions are generated from the calendar date, not observed, and have no relation to this jobsite. ' +
  `Do not record them as a weather delay. Set ${WEATHER_API_KEY_ENV} to show the live forecast.`;

/** Short per-day chip label for a single non-live day. */
export const SIMULATED_DAY_LABEL = 'SIM';

/** Shown where a reschedule is applied, to explain why nothing was logged. */
export const SIMULATED_NO_LOG_NOTICE =
  'Simulated forecast — this reschedule will NOT be recorded in the weather delay log.';

interface SourcedDay {
  source: ForecastSource;
}

/** Roll a set of days up to one verdict. `[]` → 'empty'. */
export function summarizeForecastSource(days: readonly SourcedDay[]): ForecastCoverage {
  if (days.length === 0) return 'empty';
  let live = 0;
  for (const d of days) if (d.source === 'live') live++;
  if (live === days.length) return 'live';
  if (live === 0) return 'simulated';
  return 'mixed';
}

/** True when at least one day is not a real reading — i.e. when the UI marker
 *  must be shown. */
export function hasSimulatedDays(days: readonly SourcedDay[]): boolean {
  const coverage = summarizeForecastSource(days);
  return coverage === 'simulated' || coverage === 'mixed';
}

/** How many of these days are invented. */
export function countSimulatedDays(days: readonly SourcedDay[]): number {
  let n = 0;
  for (const d of days) if (d.source !== 'live') n++;
  return n;
}

/**
 * Split a set of ISO dates by the provenance of the forecast day that covers
 * each one. A date with no matching forecast day is treated as simulated —
 * unknown provenance is never promoted to evidence.
 */
export function partitionDatesBySource(
  dates: readonly string[],
  days: readonly (SourcedDay & { date: string })[],
): { live: string[]; simulated: string[] } {
  const sourceByDate = new Map<string, ForecastSource>();
  for (const d of days) sourceByDate.set(d.date, d.source);
  const live: string[] = [];
  const simulated: string[] = [];
  for (const date of dates) {
    if (sourceByDate.get(date) === 'live') live.push(date);
    else simulated.push(date);
  }
  return { live, simulated };
}
