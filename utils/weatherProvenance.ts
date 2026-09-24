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
// Pure: no React, no react-native. Its only import is utils/geocodeProject
// (itself import-free), for the place name and the "what counts as a
// location" rule. Safe for bun validators. Structural params (not
// `DayForecast`) so weatherService can import this without a cycle.

import { cachedPlaceName, usableLocationText } from './geocodeProject';

/** Where a single day's reading came from. */
export type ForecastSource =
  /** A real reading fetched from the OpenWeather API. */
  | 'live'
  /** Invented by getSimulatedForecast() — seeded pseudo-random, seasonal
   *  only, with NO relation to the jobsite. Never evidence. */
  | 'simulated';

/** Provenance of a whole forecast window (or of a set of delay dates). */
export type ForecastCoverage = 'live' | 'mixed' | 'simulated' | 'empty';

/** The client-side env var for a direct OpenWeather key (native builds get it
 *  from EAS). Without it the app asks the weather-forecast edge function,
 *  which holds the server's key. Developer-facing ONLY — never put it in copy
 *  a contractor reads (2026-09-24: the banner told a GC to "Set
 *  EXPO_PUBLIC_OPENWEATHER_API_KEY"). */
export const WEATHER_API_KEY_ENV = 'EXPO_PUBLIC_OPENWEATHER_API_KEY';

/** Unmissable headline for the in-app marker. Deliberately shouty — a
 *  contractor must never mistake invented weather for a forecast. */
export const SIMULATED_WEATHER_HEADLINE = 'SIMULATED WEATHER — NOT A FORECAST';

/** Body copy under the headline. Says what it is; the CAUSE (no address vs
 *  live weather unreachable) comes from describeForecast() and is appended by
 *  the banner, in plain words. */
export const SIMULATED_WEATHER_BODY =
  'These conditions are generated from the calendar date, not observed, and have no relation to this jobsite. ' +
  'Do not record them as a weather delay.';

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

// ─────────────────────────────────────────────────────────────────────────
// WHERE the weather is for, and WHY it is simulated (2026-09-24).
//
// Every forecast surface used to print numbers with no place attached, so two
// jobs addressed "United States" showed Kansas weather with nothing on screen
// to say so. Now every surface names the place ("Weather for Park Slope,
// Brooklyn") and, when it falls back to simulated days, says the real cause in
// words a contractor can act on.
// ─────────────────────────────────────────────────────────────────────────

/** The location a surface asked the forecast for — the same object it passes
 *  to getForecastWithFallback. */
export interface WeatherLocationInput {
  city?: string;
  latitude?: number;
  longitude?: number;
}

export const NO_ADDRESS_WEATHER_CAUSE =
  'This job has no jobsite address, so there is nowhere to forecast. Add the address in Edit Project to see live weather.';

export const PADDED_TAIL_WEATHER_CAUSE =
  'Live forecasts reach about 5 days out; the later days are simulated.';

export function unavailableWeatherCause(place: string): string {
  return `Live weather for ${place} couldn't be loaded right now. Check the address in Edit Project, or try again later.`;
}

export interface ForecastDescription {
  /** The place the forecast is for, or null when the job has no location. */
  place: string | null;
  /** "Weather for Park Slope, Brooklyn" — only when at least one day is live. */
  placeLine: string | null;
  /** Why simulated days are on screen, in plain words — null when all live. */
  cause: string | null;
}

/**
 * The single rule for "where is this weather for, and why is it simulated".
 * A location only counts when its TEXT is usable (blank or a country on its
 * own is no location — stored coordinates for it are ignored, which is also
 * what weatherService does). The place prefers the geocoder's own name for the
 * address, then the typed address.
 */
export function describeForecast(
  location: WeatherLocationInput,
  days: readonly SourcedDay[],
): ForecastDescription {
  const text = usableLocationText(location.city);
  const place = text ? (cachedPlaceName(text) ?? text) : null;
  if (days.length === 0) return { place, placeLine: null, cause: null };
  const coverage = summarizeForecastSource(days);
  if (!place) {
    return { place: null, placeLine: null, cause: coverage === 'live' ? null : NO_ADDRESS_WEATHER_CAUSE };
  }
  if (coverage === 'live') return { place, placeLine: `Weather for ${place}`, cause: null };
  if (coverage === 'mixed') return { place, placeLine: `Weather for ${place}`, cause: PADDED_TAIL_WEATHER_CAUSE };
  return { place, placeLine: null, cause: unavailableWeatherCause(place) };
}

export type WeatherCheckTone = 'alert' | 'ok' | 'info';

/**
 * What the Schedule tab's weather button says after a check. It used to query a
 * different service at a silent New York default and say nothing at all when
 * there were no alerts. Alerts are only ever raised from LIVE days — a
 * simulated day is invented and cannot put a task at risk.
 */
export function weatherCheckMessage(opts: {
  place: string | null;
  /** The forecast has not come back yet (no days at all). */
  loading?: boolean;
  liveDays: number;
  sensitiveTasks: number;
  alertCount: number;
}): { tone: WeatherCheckTone; text: string } {
  if (!opts.place) {
    return { tone: 'info', text: 'Add a jobsite address to check weather — open the job, tap Edit, and type the address.' };
  }
  if (opts.loading) {
    return { tone: 'info', text: `Still loading the forecast for ${opts.place} — tap again in a moment.` };
  }
  if (opts.liveDays === 0) {
    return { tone: 'info', text: `Live weather for ${opts.place} isn't available right now, so nothing was checked.` };
  }
  if (opts.sensitiveTasks === 0) {
    return { tone: 'info', text: `No tasks are marked weather-sensitive, so there is nothing to check. Weather for ${opts.place}.` };
  }
  if (opts.alertCount > 0) {
    return {
      tone: 'alert',
      text: `${opts.alertCount} weather alert${opts.alertCount === 1 ? '' : 's'} for upcoming tasks. Weather for ${opts.place}.`,
    };
  }
  return {
    tone: 'ok',
    text: `No bad weather for weather-sensitive tasks in the next ${opts.liveDays} day${opts.liveDays === 1 ? '' : 's'}. Weather for ${opts.place}.`,
  };
}
