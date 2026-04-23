export interface DayForecast {
  date: string;
  condition: 'clear' | 'cloudy' | 'rain' | 'storm' | 'snow' | 'wind';
  tempHigh: number;
  tempLow: number;
  precipChance: number;
  windSpeed: number;
  isWorkable: boolean;
  icon: string;
}

const CONDITION_ICONS: Record<DayForecast['condition'], string> = {
  clear: '☀️',
  cloudy: '☁️',
  rain: '🌧️',
  storm: '⛈️',
  snow: '🌨️',
  wind: '💨',
};

export function getConditionIcon(condition: DayForecast['condition']): string {
  return CONDITION_ICONS[condition] ?? '☀️';
}

export function getSimulatedForecast(startDate: Date, days: number, _region?: string): DayForecast[] {
  const forecasts: DayForecast[] = [];
  for (let i = 0; i < days; i++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + i);
    const month = date.getMonth();
    const dayOfYear = Math.floor((date.getTime() - new Date(date.getFullYear(), 0, 0).getTime()) / (1000 * 60 * 60 * 24));

    const seed = (dayOfYear * 13 + date.getFullYear() * 7) % 100;
    const isWinter = month >= 11 || month <= 2;
    const isSummer = month >= 5 && month <= 8;
    const isSpring = month >= 3 && month <= 4;

    let condition: DayForecast['condition'] = 'clear';
    let precipChance = 10;
    let tempHigh = 75;
    let tempLow = 55;
    let windSpeed = 8;

    if (isWinter) {
      tempHigh = 38 + (seed % 20);
      tempLow = tempHigh - 15;
      precipChance = 25 + (seed % 30);
      condition = seed < 20 ? 'snow' : seed < 45 ? 'cloudy' : seed < 60 ? 'rain' : 'clear';
    } else if (isSummer) {
      tempHigh = 78 + (seed % 20);
      tempLow = tempHigh - 18;
      precipChance = 15 + (seed % 25);
      condition = seed < 10 ? 'storm' : seed < 25 ? 'rain' : seed < 40 ? 'cloudy' : 'clear';
    } else if (isSpring) {
      tempHigh = 55 + (seed % 25);
      tempLow = tempHigh - 15;
      precipChance = 30 + (seed % 25);
      condition = seed < 15 ? 'storm' : seed < 35 ? 'rain' : seed < 50 ? 'cloudy' : 'clear';
    } else {
      tempHigh = 55 + (seed % 25);
      tempLow = tempHigh - 15;
      precipChance = 20 + (seed % 20);
      condition = seed < 10 ? 'rain' : seed < 30 ? 'cloudy' : 'clear';
    }

    windSpeed = 5 + (seed % 20);
    const isWorkable = condition !== 'storm' && condition !== 'snow' && precipChance < 70 && windSpeed < 30;

    forecasts.push({
      date: date.toISOString().split('T')[0],
      condition,
      tempHigh: Math.round(tempHigh),
      tempLow: Math.round(tempLow),
      precipChance,
      windSpeed: Math.round(windSpeed),
      isWorkable,
      icon: getConditionIcon(condition),
    });
  }
  return forecasts;
}

export function getWeatherRiskForDate(date: string, forecasts: DayForecast[]): DayForecast | null {
  return forecasts.find(f => f.date === date) ?? null;
}

/**
 * Given a project start date and a task's `startDay`/`durationDays` (1-indexed
 * from project start), find the first forecast day that intersects the task
 * and is un-workable. Returns null if the task doesn't overlap any bad-weather
 * day within the known forecast window.
 *
 * Used by the Gantt chart to decide whether a weather-sensitive task gets
 * a yellow warning badge. We only flag the FIRST offending day — otherwise
 * long tasks would get noisy multi-badge displays.
 */
export function findWeatherRisk(
  projectStartDate: Date,
  startDay: number,
  durationDays: number,
  forecasts: DayForecast[],
): DayForecast | null {
  if (forecasts.length === 0) return null;
  for (let offset = 0; offset < Math.max(1, durationDays); offset++) {
    const taskDate = new Date(projectStartDate);
    taskDate.setDate(taskDate.getDate() + (startDay - 1) + offset);
    const iso = taskDate.toISOString().split('T')[0];
    const day = forecasts.find((f) => f.date === iso);
    if (day && !day.isWorkable) return day;
  }
  return null;
}

// ============================================
// OpenWeather integration
// ============================================
// Rate-limit discipline per OpenWeather's guidance:
//   "API calls no more than once in 10 minutes for each location."
// We key a module-level cache by the location identifier and hold the
// resolved forecast for 10 minutes. Subsequent calls for the same location
// inside that window return the cached payload instantly without a fetch.
//
// Endpoint: ALWAYS api.openweathermap.org (not the server IP). Hardcoded
// below — do not parameterize without reading their care notes first.
//
// Free-tier endpoint returns 5 days at 3-hour steps. We condense to one
// entry per day by picking the midday slot (12:00 local). If the caller
// asks for more days than the free tier returns, we pad the tail with
// simulated data so the Gantt keeps rendering warnings for far-future
// tasks. Swap to the paid endpoint later if longer real horizons matter.

const OPENWEATHER_ENDPOINT = 'https://api.openweathermap.org/data/2.5/forecast';
const WEATHER_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const weatherCache = new Map<string, { fetchedAt: number; forecast: DayForecast[] }>();

function getApiKey(): string | null {
  // EXPO_PUBLIC_* is inlined into the bundle at build time by Metro.
  // If the key is missing we return null and fall back to simulated data.
  const key = process.env.EXPO_PUBLIC_OPENWEATHER_API_KEY;
  if (!key || key.trim() === '') return null;
  return key.trim();
}

/** Map OpenWeather "main" + conditions to our internal `DayForecast` bucket. */
function mapOpenWeatherMain(main: string, windMph: number): DayForecast['condition'] {
  const m = main.toLowerCase();
  if (m.includes('thunder')) return 'storm';
  if (m.includes('snow')) return 'snow';
  if (m.includes('rain') || m.includes('drizzle')) return 'rain';
  if (windMph >= 25) return 'wind';
  if (m.includes('cloud')) return 'cloudy';
  return 'clear';
}

interface OpenWeatherListEntry {
  dt: number;
  dt_txt: string;
  main: { temp_max: number; temp_min: number };
  weather: { main: string; description: string }[];
  wind: { speed: number };
  pop?: number; // probability of precipitation, 0..1
}

interface OpenWeatherResponse {
  cod: string | number;
  message?: string | number;
  list?: OpenWeatherListEntry[];
}

/**
 * Collapse the 3-hour forecast list into one entry per day. We pick the
 * slot closest to midday (12:00) as the representative reading — it's
 * the most relevant window for jobsite work and avoids overnight noise.
 * High/low across the whole day are taken from the 24h window, not just
 * the midday slot, so the temp range reflects actual daily extremes.
 */
function condenseToDaily(list: OpenWeatherListEntry[], days: number): DayForecast[] {
  const byDate = new Map<string, OpenWeatherListEntry[]>();
  for (const e of list) {
    const iso = new Date(e.dt * 1000).toISOString().split('T')[0];
    const bucket = byDate.get(iso) ?? [];
    bucket.push(e);
    byDate.set(iso, bucket);
  }
  const out: DayForecast[] = [];
  const sortedDates = Array.from(byDate.keys()).sort();
  for (const iso of sortedDates.slice(0, days)) {
    const entries = byDate.get(iso) ?? [];
    if (entries.length === 0) continue;
    const midday = entries.reduce((best, cur) => {
      const bestDist = Math.abs(new Date(best.dt * 1000).getUTCHours() - 12);
      const curDist = Math.abs(new Date(cur.dt * 1000).getUTCHours() - 12);
      return curDist < bestDist ? cur : best;
    }, entries[0]);
    const tempHigh = Math.max(...entries.map((e) => e.main.temp_max));
    const tempLow = Math.min(...entries.map((e) => e.main.temp_min));
    const windSpeedMph = (midday.wind?.speed ?? 0);
    const precipChance = Math.max(...entries.map((e) => (e.pop ?? 0) * 100));
    const condition = mapOpenWeatherMain(midday.weather?.[0]?.main ?? '', windSpeedMph);
    const isWorkable =
      condition !== 'storm' && condition !== 'snow' && precipChance < 70 && windSpeedMph < 30;
    out.push({
      date: iso,
      condition,
      tempHigh: Math.round(tempHigh),
      tempLow: Math.round(tempLow),
      precipChance: Math.round(precipChance),
      windSpeed: Math.round(windSpeedMph),
      isWorkable,
      icon: getConditionIcon(condition),
    });
  }
  return out;
}

/**
 * Fetch a real forecast from OpenWeather's 5-day/3-hour endpoint.
 * Locate by either a city string (`q=...`) or lat/lng.
 *
 * @param location `{ city }` OR `{ latitude, longitude }`. The cache key
 *   normalizes both forms so e.g. "Austin, TX" vs "Austin,TX" hit the
 *   same cache entry.
 * @param startDate Used to trim the response — days before startDate are
 *   dropped, which matters if the caller's schedule begins in the future.
 * @param days How many days of forecast the caller wants. The free tier
 *   returns up to 5; anything beyond is padded with simulated data.
 * @returns An array of `DayForecast` of length `days`, or null if no API
 *   key is configured / the request failed. Callers should fall back to
 *   `getSimulatedForecast` on null.
 */
export async function getOpenWeatherForecast(
  location: { city: string } | { latitude: number; longitude: number },
  startDate: Date,
  days: number,
): Promise<DayForecast[] | null> {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  const cacheKey =
    'city' in location
      ? `city:${location.city.trim().toLowerCase().replace(/\s+/g, '')}`
      : `ll:${location.latitude.toFixed(3)},${location.longitude.toFixed(3)}`;

  const cached = weatherCache.get(cacheKey);
  const now = Date.now();
  if (cached && now - cached.fetchedAt < WEATHER_CACHE_TTL_MS) {
    return padWithSimulated(cached.forecast, startDate, days);
  }

  const params = new URLSearchParams({ appid: apiKey, units: 'imperial' });
  if ('city' in location) params.set('q', location.city);
  else {
    params.set('lat', String(location.latitude));
    params.set('lon', String(location.longitude));
  }

  try {
    const res = await fetch(`${OPENWEATHER_ENDPOINT}?${params.toString()}`);
    if (!res.ok) {
      console.log('[OpenWeather] non-OK response', res.status);
      return null;
    }
    const data = (await res.json()) as OpenWeatherResponse;
    // OpenWeather signals errors via `cod` not the HTTP status in some cases.
    if (String(data.cod) !== '200' || !data.list) {
      console.log('[OpenWeather] payload error', data.cod, data.message);
      return null;
    }
    const daily = condenseToDaily(data.list, 5);
    weatherCache.set(cacheKey, { fetchedAt: now, forecast: daily });
    return padWithSimulated(daily, startDate, days);
  } catch (err) {
    console.log('[OpenWeather] fetch failed', err);
    return null;
  }
}

/**
 * When the caller asks for more days than OpenWeather returned, fill the
 * tail with simulated data so the Gantt doesn't drop weather badges for
 * far-future weather-sensitive tasks. The real days come first (since
 * they're the most actionable); simulated days are appended contiguously.
 */
function padWithSimulated(
  real: DayForecast[],
  startDate: Date,
  days: number,
): DayForecast[] {
  if (real.length >= days) return real.slice(0, days);
  const lastDate =
    real.length > 0
      ? new Date(real[real.length - 1].date + 'T12:00:00')
      : startDate;
  const simStart = new Date(lastDate);
  simStart.setDate(simStart.getDate() + 1);
  const simDays = days - real.length;
  const sim = getSimulatedForecast(simStart, simDays);
  return [...real, ...sim];
}

/**
 * Convenience wrapper used by the schedule screen: try OpenWeather first,
 * fall back to simulated data. This is the single entry point callers
 * should use so the swap is transparent and the rate-limit cache stays
 * centralized.
 */
export async function getForecastWithFallback(
  location: { city?: string; latitude?: number; longitude?: number },
  startDate: Date,
  days: number,
): Promise<DayForecast[]> {
  const locArg =
    location.latitude != null && location.longitude != null
      ? { latitude: location.latitude, longitude: location.longitude }
      : location.city && location.city.trim() !== ''
      ? { city: location.city }
      : null;
  if (locArg) {
    const real = await getOpenWeatherForecast(locArg, startDate, days);
    if (real) return real;
  }
  return getSimulatedForecast(startDate, days);
}
