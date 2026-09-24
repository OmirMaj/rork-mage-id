// weather-forecast — OpenWeather's 5-day / 3-hour forecast for one jobsite,
// fetched with the SERVER's key.
//
// WHY (2026-09-24): the web app at app.mageid.app is built without
// EXPO_PUBLIC_OPENWEATHER_API_KEY, so Metro inlined `undefined` and the
// client's live-weather call was compiled down to `return null` — every
// forecast on the web was simulated. Putting the key in the Netlify build
// would publish it in the bundle. This function uses the OPENWEATHER_API_KEY
// secret the morning digest already has; utils/weatherService.ts calls it
// whenever the build has no client key. The client never sees the key.
//
// Request (POST JSON):  { latitude, longitude }  or  { city }
// Response: the OpenWeather payload the client already condenses —
//   { cod: '200', list: [...], city: { name, timezone } }
// trimmed to the fields utils/weatherService.condenseToDaily reads.
//
// Auth: any signed-in user (requireTier over every tier; the gateway also
// verifies the JWT — config.toml pins verify_jwt = true). Rate limit: a
// per-user hourly ceiling on top of the client's own 10-minute cache per
// location, and a per-isolate cache here for the same 10 minutes.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { requireTier, rateLimitCount } from '../_shared/auth.ts';

const OPENWEATHER_API_KEY = Deno.env.get('OPENWEATHER_API_KEY') ?? '';
const OPENWEATHER_ENDPOINT = 'https://api.openweathermap.org/data/2.5/forecast';

/** Three weather surfaces × a handful of project switches an hour, each
 *  already cached 10 minutes per location on the device. */
const HOURLY_LIMIT = 120;
const CACHE_TTL_MS = 10 * 60 * 1000;
const UPSTREAM_TIMEOUT_MS = 8000;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

type Query = { latitude: number; longitude: number } | { city: string };

/** Accept exactly one well-formed location; refuse anything else. */
export function parseQuery(body: unknown): Query | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const lat = b.latitude;
  const lng = b.longitude;
  if (typeof lat === 'number' && typeof lng === 'number') {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    return { latitude: lat, longitude: lng };
  }
  if (typeof b.city === 'string') {
    const city = b.city.trim();
    // eslint-disable-next-line no-control-regex
    if (city.length < 3 || city.length > 200 || /[\u0000-\u001f]/.test(city)) return null;
    return { city };
  }
  return null;
}

function cacheKey(q: Query): string {
  return 'city' in q
    ? `city:${q.city.toLowerCase().replace(/\s+/g, '')}`
    : `ll:${q.latitude.toFixed(3)},${q.longitude.toFixed(3)}`;
}

interface Upstream {
  cod?: string | number;
  message?: string | number;
  list?: Array<{
    dt: number;
    dt_txt?: string;
    main?: { temp_max?: number; temp_min?: number };
    weather?: Array<{ main?: string; description?: string }>;
    wind?: { speed?: number };
    pop?: number;
  }>;
  city?: { name?: string; timezone?: number };
}

const cache = new Map<string, { at: number; body: unknown }>();

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ success: false, error: 'POST only.' }, 405);

  const auth = await requireTier(req, ['free', 'pro', 'business', 'enterprise'], 'weather_forecast');
  if (!auth.ok) return json(auth.body, auth.status);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ success: false, error: 'Send a JSON body with latitude/longitude or city.', code: 'bad_request' }, 400);
  }
  const query = parseQuery(body);
  if (!query) {
    return json({ success: false, error: 'Send latitude/longitude in range, or a city of 3–200 characters.', code: 'bad_request' }, 400);
  }

  if (!OPENWEATHER_API_KEY) {
    return json({ success: false, error: 'Live weather is not configured on the server.', code: 'weather_not_configured' }, 503);
  }

  const hourly = await rateLimitCount(`weather-forecast:user:${auth.userId}`);
  if (hourly < 0) return json({ success: false, error: 'Rate limiter unavailable — please try again in a moment.', code: 'rate_limiter_unavailable' }, 503);
  if (hourly - 1 >= HOURLY_LIMIT) return json({ success: false, error: `Hourly limit reached (${HOURLY_LIMIT} per hour).`, code: 'hourly_limit' }, 429);

  const key = cacheKey(query);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return json(hit.body);

  const params = new URLSearchParams({ appid: OPENWEATHER_API_KEY, units: 'imperial' });
  if ('city' in query) params.set('q', query.city);
  else {
    params.set('lat', String(query.latitude));
    params.set('lon', String(query.longitude));
  }

  let data: Upstream;
  try {
    const res = await fetch(`${OPENWEATHER_ENDPOINT}?${params.toString()}`, {
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    data = await res.json() as Upstream;
    if (!res.ok || String(data.cod) !== '200' || !Array.isArray(data.list)) {
      // Never echo the upstream URL: it carries the key.
      return json({ success: false, cod: String(data.cod ?? res.status), error: 'No forecast for that location.', code: 'no_forecast' }, 502);
    }
  } catch (err) {
    console.error('[weather-forecast] upstream failed:', err instanceof Error ? err.name : 'error');
    return json({ success: false, error: 'Weather service unreachable.', code: 'upstream_failed' }, 502);
  }

  const out = {
    cod: '200',
    list: data.list.map((e) => ({
      dt: e.dt,
      dt_txt: e.dt_txt ?? '',
      main: { temp_max: e.main?.temp_max ?? 0, temp_min: e.main?.temp_min ?? 0 },
      weather: (e.weather ?? []).slice(0, 1).map((w) => ({ main: w.main ?? '', description: w.description ?? '' })),
      wind: { speed: e.wind?.speed ?? 0 },
      pop: e.pop ?? 0,
    })),
    city: { name: data.city?.name ?? '', timezone: data.city?.timezone ?? 0 },
  };
  if (cache.size > 500) cache.clear();
  cache.set(key, { at: Date.now(), body: out });
  return json(out);
});
