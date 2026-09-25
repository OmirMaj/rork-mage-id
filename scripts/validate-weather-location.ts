// validate-weather-location.ts — lane Q2, 2026-09-24: "How is weather
// location determined?"
//
// What the founder's live data showed: two jobs addressed "United States"
// carried Nominatim's country centroid (Lebanon, Kansas) and every weather
// surface showed confident, unlabelled Kansas weather for them; a Brooklyn job
// had never been geocoded; the web build had no key so every forecast was
// simulated; the Schedule tab's cloud button silently used New York through a
// second weather service; Lookahead ignored the saved coordinates; no surface
// named the place; the Today card showed tomorrow's weather every evening.
//
// This guard pins each fix:
//   [1] a country on its own is NO location (geocode, backfill, weather, card)
//   [2] coarse geocoder hits are refused; place names shorten sanely
//   [3] Nominatim policy: ≥1.1 s between requests, cache, in-flight dedupe
//   [4] backfill / centroid scrub / stale-coordinate / late-geocode rules
//   [5] forecast resolution: country-only ignores its (Kansas) coordinates,
//       coordinates first, geocode before `q=`, relay when no client key
//   [6] days bucketed on the JOBSITE's calendar, midday at the jobsite
//   [7] place + cause copy; the weather button's sentences; no env-var jargon
//   [8] source wiring: no 'United States' writers in this lane's files, no
//       New York / Open-Meteo in the Schedule tab, Lookahead gets coordinates,
//       the relay function, config.toml, the migration and the digest
//
// Run: bun scripts/validate-weather-location.ts

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  isCountryOnlyLocation, usableLocationText, isCoarseGeocodeResult, shortPlaceName,
  geocodeProjectLocation, __resetGeocodeForTests, NOMINATIM_MIN_INTERVAL_MS, GEOCODE_NEGATIVE_TTL_MS,
  shouldGeocode, pickGeocodeBackfill, pickCountryCentroidCoords, clearCoordsOnLocationChange,
  geocodeStillApplies, classifyProjectLocation, cachedPlaceName, COUNTRY_ONLY_LOCATIONS,
  GEOCODE_BACKFILL_MAX_PER_SESSION, type GeoProjectLike,
} from '../utils/geocodeProject';
import {
  getForecastWithFallback, resolveWeatherQuery, condenseToDaily, __setWeatherTransportForTests,
  type OpenWeatherListEntry, type OpenWeatherResponse, type WeatherQuery,
} from '../utils/weatherService';
import {
  describeForecast, weatherCheckMessage, SIMULATED_WEATHER_BODY, NO_ADDRESS_WEATHER_CAUSE,
  PADDED_TAIL_WEATHER_CAUSE,
} from '../utils/weatherProvenance';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail = ''): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`); }
}

async function main(): Promise<void> {
  // ── [1] ────────────────────────────────────────────────────────────────
  console.log('\n[1] a country on its own is no location');
  for (const s of ['United States', 'united states', ' USA ', 'U.S.', 'U.S.A.', 'US', 'America', 'United  States', 'United States of America']) {
    ok(`'${s}' is country-only`, isCountryOnlyLocation(s) && usableLocationText(s) === null);
  }
  for (const s of ['Houston, TX', '124 Park Slope, Brooklyn NY 11215', 'Austin', 'US 290, Dripping Springs TX']) {
    ok(`'${s}' is a usable location`, !isCountryOnlyLocation(s) && usableLocationText(s) === s.trim());
  }
  ok('blank / too short is no location', usableLocationText('') === null && usableLocationText('  ') === null && usableLocationText('NY') === null && usableLocationText(undefined) === null);
  ok('shouldGeocode refuses a country on its own, even with no coordinates',
    shouldGeocode(undefined, 'United States', false, undefined) === false);
  ok('shouldGeocode still asks for a real address with no coordinates',
    shouldGeocode(undefined, 'Houston, TX', false, undefined) === true);
  ok('coverage card: the Kansas-centroid job counts as blank, not "has a location"',
    classifyProjectLocation({ location: 'United States', locationLatitude: 39.7837304, locationLongitude: -100.445882 }) === 'blank');
  ok('coverage card: a Brooklyn address with no coordinates is text-only',
    classifyProjectLocation({ location: '124 Park Slope, Brooklyn NY 11215' }) === 'text_only');
  ok('coverage card: an address with coordinates is geocoded',
    classifyProjectLocation({ location: 'Houston, TX', locationLatitude: 29.76, locationLongitude: -95.36 }) === 'geocoded');

  // ── [2] ────────────────────────────────────────────────────────────────
  console.log('\n[2] coarse hits are refused; names shorten');
  ok('a country hit is coarse', isCoarseGeocodeResult({ addresstype: 'country', place_rank: 4 }));
  ok('a state hit is coarse', isCoarseGeocodeResult({ addresstype: 'state', place_rank: 8 }));
  ok('a county-rank hit is coarse (place_rank < 16)', isCoarseGeocodeResult({ addresstype: 'county', place_rank: 12 }));
  ok('a city hit is precise enough', !isCoarseGeocodeResult({ addresstype: 'city', place_rank: 16 }));
  ok('a house hit is precise', !isCoarseGeocodeResult({ addresstype: 'building', place_rank: 30 }));
  ok('a suburb hit is precise', !isCoarseGeocodeResult({ addresstype: 'suburb', place_rank: 20 }));
  ok('Park Slope display name shortens to "Park Slope, Brooklyn"',
    shortPlaceName('124, Park Slope, Brooklyn, Kings County, City of New York, New York, 11215, United States') === 'Park Slope, Brooklyn',
    String(shortPlaceName('124, Park Slope, Brooklyn, Kings County, City of New York, New York, 11215, United States')));
  ok('Houston display name shortens to "Houston, Texas"',
    shortPlaceName('Houston, Harris County, Texas, United States') === 'Houston, Texas');
  ok('an empty display name has no short name', shortPlaceName('') === null && shortPlaceName(undefined) === null);

  // ── [3] ────────────────────────────────────────────────────────────────
  console.log('\n[3] Nominatim policy: throttle, cache, dedupe');
  let clock = 1_000_000;
  const starts: number[] = [];
  const urls: string[] = [];
  let reply: (url: string) => unknown = () => [];
  __resetGeocodeForTests({
    now: () => clock,
    // Wake at the reserved moment (computed at call time), like a real timer.
    // Real timers at 1/100 scale keep wake-up ORDER honest.
    sleep: async (ms) => {
      const target = clock + ms;
      await new Promise((r) => setTimeout(r, ms / 100));
      clock = Math.max(clock, target);
    },
    fetch: async (url) => {
      starts.push(clock);
      urls.push(url);
      return { ok: true, json: async () => reply(url) };
    },
  });
  reply = (url) => url.includes('Brooklyn')
    ? [{ lat: '40.670', lon: '-73.986', display_name: 'Park Slope, Brooklyn, Kings County, New York, 11215, United States', place_rank: 20, addresstype: 'suburb' }]
    : url.includes('Texas')
      ? [{ lat: '31.0', lon: '-99.0', display_name: 'Texas, United States', place_rank: 8, addresstype: 'state' }]
      : url.includes('Houston')
        ? [{ lat: '29.76', lon: '-95.36', display_name: 'Houston, Harris County, Texas, United States', place_rank: 16, addresstype: 'city' }]
        : [];
  const [a, b, c] = await Promise.all([
    geocodeProjectLocation('124 Park Slope, Brooklyn NY 11215'),
    geocodeProjectLocation('Houston, TX'),
    geocodeProjectLocation('Somewhere Nowhere 99999'),
  ]);
  ok('three different addresses make three requests', starts.length === 3, `made ${starts.length}`);
  const gaps = starts.slice(1).map((t, i) => t - starts[i]);
  ok(`consecutive requests are at least ${NOMINATIM_MIN_INTERVAL_MS} ms apart`,
    gaps.every((g) => g >= NOMINATIM_MIN_INTERVAL_MS), `gaps: ${gaps.join(', ')}`);
  ok('results come back', !!a && a.latitude === 40.67 && !!b && b.latitude === 29.76 && c === null);
  ok('requests use jsonv2 (place_rank + addresstype) and one result', urls.every((u) => u.includes('format=jsonv2') && u.includes('limit=1')));
  const before = starts.length;
  const again = await geocodeProjectLocation('124  park slope, brooklyn ny 11215');
  ok('a repeated address (any spacing / case) is served from cache', starts.length === before && again?.latitude === 40.67);
  const dupes = await Promise.all([geocodeProjectLocation('Houston Heights, TX'), geocodeProjectLocation('Houston Heights, TX')]);
  ok('identical queries in flight share ONE request', starts.length === before + 1 && dupes[0] === dupes[1]);
  const missBefore = starts.length;
  await geocodeProjectLocation('Somewhere Nowhere 99999');
  ok('a "not found" is remembered (no re-ask inside the negative TTL)', starts.length === missBefore);
  clock += GEOCODE_NEGATIVE_TTL_MS + 1;
  await geocodeProjectLocation('Somewhere Nowhere 99999');
  ok('…and re-asked after it', starts.length === missBefore + 1);
  const texBefore = starts.length;
  const tex = await geocodeProjectLocation('Texas');
  ok('a state-level hit is refused (null), not a point in the middle of Texas', tex === null && starts.length === texBefore + 1);
  const usBefore = starts.length;
  const us = await geocodeProjectLocation('United States');
  ok("'United States' never reaches the network", us === null && starts.length === usBefore);
  ok('raw "lat, lng" text parses without a request',
    (await geocodeProjectLocation('40.71, -74.01'))?.latitude === 40.71 && starts.length === usBefore);
  ok('the resolved place name is available for "Weather for …"',
    cachedPlaceName('124 Park Slope, Brooklyn NY 11215') === 'Park Slope, Brooklyn');

  // ── [4] ────────────────────────────────────────────────────────────────
  console.log('\n[4] backfill, scrub, stale coordinates, late answers');
  const me = 'u1';
  const projects = [
    { id: 'henderson', location: '124 Park Slope, Brooklyn NY 11215', ownerUserId: me },
    { id: 'houston-ad', location: 'United States', ownerUserId: me, locationLatitude: 39.7837304, locationLongitude: -100.445882, locationGeocodedAt: '2026-08-01T00:00:00Z' },
    { id: 'furniture', location: '', ownerUserId: me },
    { id: 'shared', location: 'Austin, TX', ownerUserId: 'someone-else' },
    { id: 'done', location: 'Dallas, TX', ownerUserId: me, locationLatitude: 32.7, locationLongitude: -96.8 },
    { id: 'legacy', location: 'El Paso, TX' },
  ];
  const picked = pickGeocodeBackfill(projects, new Set(), me).map((p) => p.id);
  ok('backfill picks own jobs with an address and no coordinates', JSON.stringify(picked) === JSON.stringify(['henderson', 'legacy']), picked.join(','));
  ok('backfill never picks a job twice in a session', pickGeocodeBackfill(projects, new Set(['henderson', 'legacy']), me).length === 0);
  const many = Array.from({ length: 30 }, (_, i) => ({ id: `p${i}`, location: `${i} Main St, Austin TX`, ownerUserId: me }));
  ok(`backfill is bounded (${GEOCODE_BACKFILL_MAX_PER_SESSION} per session)`,
    pickGeocodeBackfill(many, new Set(), me).length === GEOCODE_BACKFILL_MAX_PER_SESSION &&
    pickGeocodeBackfill(many, new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']), me).length === 2);
  ok('the centroid scrub picks exactly the country-only job with coordinates',
    JSON.stringify(pickCountryCentroidCoords(projects).map((p) => p.id)) === JSON.stringify(['houston-ad']));
  const cleared: Partial<GeoProjectLike> = clearCoordsOnLocationChange({ location: 'Old St, Austin TX' }, { location: 'New St, Austin TX' } as Partial<GeoProjectLike>);
  ok('an address change clears the old coordinates in the same write',
    'locationLatitude' in cleared && cleared.locationLatitude === undefined && cleared.locationLongitude === undefined && cleared.locationGeocodedAt === undefined);
  ok('an update that does not touch the address keeps coordinates',
    !('locationLatitude' in clearCoordsOnLocationChange({ location: 'A St' }, { name: 'x' } as { location?: string })));
  ok('an unchanged address keeps coordinates',
    !('locationLatitude' in clearCoordsOnLocationChange({ location: 'A St' }, { location: 'A St' })));
  ok('an update that sets coordinates itself is left alone',
    clearCoordsOnLocationChange({ location: 'A St' }, { location: 'B St', locationLatitude: 1, locationLongitude: 2 }).locationLatitude === 1);
  ok('a late geocode for an older address does not apply', geocodeStillApplies('Second St', 'First St') === false);
  ok('a geocode for the current address applies', geocodeStillApplies('First St', 'First St') === true);

  // ── [5] ────────────────────────────────────────────────────────────────
  console.log('\n[5] which place the forecast asks for');
  const asked: WeatherQuery[] = [];
  const liveList: OpenWeatherListEntry[] = Array.from({ length: 40 }, (_, i) => ({
    dt: Date.UTC(2026, 8, 24, 0, 0, 0) / 1000 + i * 3 * 3600,
    dt_txt: '',
    main: { temp_max: 70, temp_min: 60 },
    weather: [{ main: 'Clear', description: 'clear' }],
    wind: { speed: 5 },
    pop: 0.1,
  }));
  let transportReply: OpenWeatherResponse | null = { cod: '200', list: liveList, city: { name: 'Brooklyn', timezone: -14400 } };
  __setWeatherTransportForTests(async (q) => { asked.push(q); return transportReply; });
  const start = new Date(2026, 8, 24, 12);

  const kansas = await getForecastWithFallback({ city: 'United States', latitude: 39.7837304, longitude: -100.445882 }, start, 5);
  ok("'United States' + Kansas coordinates → simulated, and OpenWeather is never asked",
    kansas.every((d) => d.source === 'simulated') && asked.length === 0);
  const blank = await getForecastWithFallback({ city: '', latitude: 39.78, longitude: -100.44 }, start, 5);
  ok('blank address + leftover coordinates → simulated, never asked', blank.every((d) => d.source === 'simulated') && asked.length === 0);
  const coords = await getForecastWithFallback({ city: 'Houston, TX', latitude: 29.76, longitude: -95.36 }, start, 5);
  ok('saved coordinates are used first', asked.length === 1 && 'latitude' in asked[0] && asked[0].latitude === 29.76 && coords.some((d) => d.source === 'live'));
  asked.length = 0;
  const q = await resolveWeatherQuery({ city: '124 Park Slope, Brooklyn NY 11215' });
  ok('an address without coordinates is geocoded before any `q=` (street text fails as a city name)',
    !!q && 'latitude' in q && q.latitude === 40.67);
  const unresolvable = await resolveWeatherQuery({ city: 'Somewhere Nowhere 99999' });
  ok('only an address the geocoder cannot resolve falls back to `q=` text',
    !!unresolvable && 'city' in unresolvable && unresolvable.city === 'Somewhere Nowhere 99999');
  transportReply = null;
  __setWeatherTransportForTests(async (qq) => { asked.push(qq); return transportReply; });
  const dead = await getForecastWithFallback({ city: 'Houston, TX', latitude: 29.76, longitude: -95.36 }, start, 5);
  ok('a dead relay / failed request → every day simulated', dead.every((d) => d.source === 'simulated'));
  const deadAgain = asked.length;
  await getForecastWithFallback({ city: 'Houston, TX', latitude: 29.76, longitude: -95.36 }, start, 5);
  ok('a failed location is not re-asked for a minute (three strips mount at once)', asked.length === deadAgain);
  __setWeatherTransportForTests(null);

  const svc = read('utils/weatherService.ts');
  const svcCode = strip(svc);
  ok('with no client key the service asks the weather-forecast edge function',
    /apiKey\s*\?\s*\(loc\)\s*=>\s*directTransport\(apiKey,\s*loc\)\s*:\s*relayTransport/.test(svcCode) &&
    /functions\.invoke\('weather-forecast'/.test(svcCode));
  ok('the relay is loaded lazily (weatherService keeps zero static runtime imports)',
    svc.split('\n').filter((l) => /^import\s/.test(l.trim()) && !/^import\s+type\s/.test(l.trim())).length === 0 &&
    /require\('@\/lib\/supabase'\)/.test(svcCode) && !/\bimport\(/.test(svcCode.replace(/typeof import\(/g, '')));

  // ── [6] ────────────────────────────────────────────────────────────────
  console.log("\n[6] days are the JOBSITE's days");
  // 3-hour slots from 2026-09-24 00:00Z. New York is UTC-4 (timezone -14400).
  const ny = condenseToDaily(liveList, 5, -14400);
  ok('the first New York day is 2026-09-23 (00:00Z is 8 PM on the 23rd there)', ny[0]?.date === '2026-09-23', ny.map((d) => d.date).join(','));
  const utc = condenseToDaily(liveList, 5, 0);
  ok('with no offset the first day is 2026-09-24 (the old UTC behaviour)', utc[0]?.date === '2026-09-24');
  // Midday: give 16:00Z (noon EDT) a distinct condition and 12:00Z (8 AM EDT) another.
  const marked = liveList.map((e) => {
    const h = new Date(e.dt * 1000).getUTCHours();
    const dayUtc = new Date(e.dt * 1000).getUTCDate();
    if (dayUtc === 24 && h === 15) return { ...e, weather: [{ main: 'Rain', description: 'rain' }] };
    if (dayUtc === 24 && h === 12) return { ...e, weather: [{ main: 'Snow', description: 'snow' }] };
    return e;
  });
  const nyMid = condenseToDaily(marked, 5, -14400).find((d) => d.date === '2026-09-24');
  ok("New York's midday reading is the 15:00Z slot (11 AM EDT), not 12:00Z (8 AM)", nyMid?.condition === 'rain', String(nyMid?.condition));
  const utcMid = condenseToDaily(marked, 5, 0).find((d) => d.date === '2026-09-24');
  ok('(control) bucketed in UTC it would have picked the 8 AM snow slot', utcMid?.condition === 'snow');

  // ── [7] ────────────────────────────────────────────────────────────────
  console.log('\n[7] the place, the cause, the button');
  const live = [{ source: 'live' as const }, { source: 'live' as const }];
  const sim = [{ source: 'simulated' as const }, { source: 'simulated' as const }];
  const mixed = [{ source: 'live' as const }, { source: 'simulated' as const }];
  ok('live forecast names the geocoder\'s place', describeForecast({ city: '124 Park Slope, Brooklyn NY 11215', latitude: 40.67, longitude: -73.98 }, live).placeLine === 'Weather for Park Slope, Brooklyn');
  ok('without a geocoder name it names the typed address', describeForecast({ city: 'Somewhere Else, TX' }, live).placeLine === 'Weather for Somewhere Else, TX');
  const noAddr = describeForecast({ city: 'United States', latitude: 39.78, longitude: -100.44 }, sim);
  ok("'United States' → no place, cause = no jobsite address", noAddr.place === null && noAddr.placeLine === null && noAddr.cause === NO_ADDRESS_WEATHER_CAUSE);
  const down = describeForecast({ city: 'Houston, TX' }, sim);
  ok('address + all simulated → "couldn\'t be loaded", naming the place', down.placeLine === null && /couldn't be loaded/.test(down.cause ?? '') && /Houston/.test(down.cause ?? ''));
  ok('address + 5 live then padded → place + horizon note', describeForecast({ city: 'Houston, TX' }, mixed).cause === PADDED_TAIL_WEATHER_CAUSE);
  ok('loading (no days) → nothing claimed yet', describeForecast({ city: 'Houston, TX' }, []).placeLine === null && describeForecast({ city: 'Houston, TX' }, []).cause === null);
  ok('the banner body no longer tells a GC to set an env var', !/EXPO_PUBLIC|Set [A-Z_]+/.test(SIMULATED_WEATHER_BODY));
  for (const cause of [NO_ADDRESS_WEATHER_CAUSE, PADDED_TAIL_WEATHER_CAUSE, down.cause ?? '']) {
    ok(`cause copy is plain words: "${cause.slice(0, 40)}…"`, !/EXPO_|API|env|key/i.test(cause));
  }
  ok('button, no address → "Add a jobsite address", never a default city',
    /Add a jobsite address/.test(weatherCheckMessage({ place: null, liveDays: 5, sensitiveTasks: 2, alertCount: 0 }).text));
  ok('button, still loading → says so', /Still loading the forecast for Houston/.test(weatherCheckMessage({ place: 'Houston', loading: true, liveDays: 0, sensitiveTasks: 1, alertCount: 0 }).text));
  ok('button, no live days → nothing checked, and says why',
    /isn't available right now, so nothing was checked/.test(weatherCheckMessage({ place: 'Houston', liveDays: 0, sensitiveTasks: 1, alertCount: 0 }).text));
  ok('button, no weather-sensitive tasks → says there is nothing to check',
    /No tasks are marked weather-sensitive/.test(weatherCheckMessage({ place: 'Houston', liveDays: 5, sensitiveTasks: 0, alertCount: 0 }).text));
  const alert = weatherCheckMessage({ place: 'Houston', liveDays: 5, sensitiveTasks: 2, alertCount: 2 });
  ok('button, alerts → count + place, alert tone', alert.tone === 'alert' && alert.text === '2 weather alerts for upcoming tasks. Weather for Houston.');
  const clear = weatherCheckMessage({ place: 'Houston', liveDays: 5, sensitiveTasks: 2, alertCount: 0 });
  ok('button, no alerts → an answer, not silence', clear.tone === 'ok' && clear.text === 'No bad weather for weather-sensitive tasks in the next 5 days. Weather for Houston.');

  // ── [8] ────────────────────────────────────────────────────────────────
  console.log('\n[8] wiring');
  const US_WRITER = /location:\s*[^,\n]*'United States'/;
  for (const rel of ['app/project-detail.tsx', 'app/(tabs)/schedule/index.tsx', 'app/(tabs)/settings/index.tsx', 'components/UniversalMicButton.tsx', 'utils/copilot/newProject/newProjectCapability.ts']) {
    ok(`${rel} writes no 'United States' location`, !US_WRITER.test(strip(read(rel))) && !/\|\|\s*'United States'/.test(strip(read(rel))));
  }
  const ctx = strip(read('contexts/ProjectContext.tsx'));
  ok("the lead converter writes '' for a lead with no address", /location:\s*lead\.address \?\? ''/.test(ctx));
  ok('ProjectContext backfills unlooked-up addresses after the server list lands',
    /pickGeocodeBackfill\(projects,/.test(ctx) && /projectsHydratedForRef\.current !== userId/.test(ctx));
  ok('ProjectContext scrubs country-only coordinates', /pickCountryCentroidCoords\(projects\)/.test(ctx));
  ok('updateProject clears coordinates on an address change', /clearCoordsOnLocationChange\(prior, updates\)/.test(ctx));
  ok('geocodeIfNeeded drops a late answer for an older address', /geocodeStillApplies\(current\.location, askedFor\)/.test(ctx));

  const sched = strip(read('app/(tabs)/schedule/index.tsx'));
  ok('the Schedule tab has no Open-Meteo call and no New York default',
    !/open-meteo/i.test(sched) && !/40\.71/.test(sched) && !/-74\.01/.test(sched));
  ok('the weather button reads the same forecast as the strips (ganttForecast)',
    /const fetchWeather = useCallback\(\(\) => \{[\s\S]{0,400}ganttForecast/.test(sched));
  ok('the weather button only raises alerts from live days', /ganttForecast\.filter\(\(f\) => f\.source === 'live'\)/.test(sched));
  ok('the weather button always answers (weatherCheckMessage)', /setWeatherCheck\(weatherCheckMessage\(/.test(sched));
  const lookMounts = sched.match(/<LookaheadView\b[^>]*\/>/g) ?? [];
  ok('both Lookahead mounts pass the saved coordinates',
    lookMounts.length === 2 && lookMounts.every((m) =>
      /locationLatitude=\{selectedProject\?\.locationLatitude\}/.test(m) && /locationLongitude=\{selectedProject\?\.locationLongitude\}/.test(m)),
    `${lookMounts.length} mounts`);
  ok('the Gantt names the place (or the cause)', (sched.match(/<WeatherPlaceLine text=\{ganttWeatherDesc\.placeLine \?\? ganttWeatherDesc\.cause\}/g) ?? []).length === 2);

  const look = strip(read('components/schedule/LookaheadView.tsx'));
  ok('LookaheadView asks with latitude/longitude', /latitude:\s*locationLatitude,\s*longitude:\s*locationLongitude/.test(look) && /\[now, weekCount, location, locationLatitude, locationLongitude\]/.test(look));
  ok('LookaheadView names the place and the cause', /<WeatherPlaceLine text=\{weatherDesc\.placeLine\}/.test(look) && /cause=\{weatherDesc\.cause\}/.test(look));
  const today = strip(read('components/schedule/TodayView.tsx'));
  ok("TodayView takes TODAY's day, not forecast[0]", /forecast\.find\(\(f\) => f\.date === todayKey\)/.test(today) && !/forecast\[0\]/.test(today));
  ok('TodayView names the place and the cause', /<WeatherPlaceLine text=\{weatherDesc\.placeLine\}/.test(today) && /cause=\{weatherDesc\.cause\}/.test(today));
  const notif = strip(read('app/notifications-settings.tsx'));
  ok('the digest location card classifies with classifyProjectLocation', /classifyProjectLocation\(p\)/.test(notif));

  // Wave 6d (Z2): the daily report's live read. It sent the typed text to
  // wttr.in (so 'United States' fetched some city's weather) and printed that
  // text on the chip instead of the place wttr.in actually read.
  const dfr = strip(read('app/daily-report.tsx'));
  ok('daily-report asks wttr.in only with usableLocationText(project?.location)',
    /const weatherQuery = usableLocationText\(project\?\.location\);/.test(dfr)
    && /encodeURIComponent\(weatherQuery\)/.test(dfr) && !/encodeURIComponent\(project\.location\)/.test(dfr));
  ok('daily-report has no `if (!project?.location) return` gate (a country-only location is not an address)',
    !/if \(!project\?\.location\) return/.test(dfr) && /if \(!weatherQuery\) \{/.test(dfr));
  ok('daily-report: a tapped fetch with no usable address says why (NO_ADDRESS_WEATHER_CAUSE); the auto one stays quiet',
    /if \(!weatherQuery\) \{\s*if \(opts\?\.auto !== true\) showAlert\('No jobsite address', NO_ADDRESS_WEATHER_CAUSE\);\s*return;\s*\}/.test(dfr));
  ok('daily-report: the mount fetch is gated on weatherQuery', /if \(!existingReport && weatherQuery\) \{\s*void fetchWeather\(\{ auto: true \}\);/.test(dfr));
  ok("daily-report reads wttr.in's nearest_area for the place it read",
    /data\?\.nearest_area\?\.\[0\]/.test(dfr) && /setWeatherPlace\(\[area\?\.areaName\?\.\[0\]\?\.value, area\?\.region\?\.\[0\]\?\.value\]\.filter\(Boolean\)\.join\(', '\) \|\| weatherQuery\)/.test(dfr));
  ok('daily-report passes weatherPlace into weatherProvenanceLine (never the typed text)',
    /weatherProvenanceLine\(\{[\s\S]{0,400}location: weatherPlace \?\? weatherQuery \?\? ''/.test(dfr)
    && !/weatherProvenanceLine\(\{[\s\S]{0,400}location: project\?\.location/.test(dfr));
  ok('daily-report clears the place with the reading (the backfill clear)',
    /setWeatherReadAt\(null\);\s*setWeatherPlace\(null\);/.test(dfr));

  const fn = read('supabase/functions/weather-forecast/index.ts');
  const fnCode = strip(fn);
  ok('weather-forecast authenticates every caller (requireTier, all tiers)', /requireTier\(req, \['free', 'pro', 'business', 'enterprise'\]/.test(fnCode));
  ok('weather-forecast is rate-limited per user', /rateLimitCount\(`weather-forecast:user:\$\{auth\.userId\}`\)/.test(fnCode));
  ok('weather-forecast uses the server secret, never a client var', /Deno\.env\.get\('OPENWEATHER_API_KEY'\)/.test(fnCode) && !/EXPO_PUBLIC/.test(fnCode));
  ok('weather-forecast never returns the upstream URL (it carries the key)', !/json\([^)]*\burl\b/.test(fnCode) && !/appid.*json\(/.test(fnCode));
  const cfg = read('supabase/config.toml');
  ok('config.toml pins weather-forecast verify_jwt = true', /\[functions\.weather-forecast\]\s*\nverify_jwt = true/.test(cfg));

  const mig = read('supabase/migrations/20260924120500_clear_country_centroid_coords.sql');
  const migCode = mig.replace(/--.*$/gm, '');
  const setCols = (migCode.match(/set\s+([\s\S]*?)\s+where/i)?.[1] ?? '').split(',').map((s) => s.trim().split(/\s*=\s*/)[0]);
  ok('the migration sets exactly the three location_* columns',
    JSON.stringify(setCols) === JSON.stringify(['location_latitude', 'location_longitude', 'location_geocoded_at']), setCols.join(','));
  ok('the migration is one UPDATE of public.projects and nothing else',
    (migCode.match(/\bupdate\b/gi) ?? []).length === 1 && /update public\.projects/i.test(migCode) &&
    !/\b(insert|delete|alter|drop|create|truncate)\b/i.test(migCode));
  ok('the migration is idempotent (only rows still carrying a value)',
    /location_latitude is not null\s+or location_longitude is not null\s+or location_geocoded_at is not null/i.test(migCode));
  const inBlock = migCode.match(/\bin \(([\s\S]*?)\n\s*\)/)?.[1] ?? '';
  const sqlList = [...inBlock.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  ok('the migration\'s country list is the client\'s COUNTRY_ONLY list',
    JSON.stringify([...sqlList].sort()) === JSON.stringify([...COUNTRY_ONLY_LOCATIONS].sort()), sqlList.join('|'));
  const digest = read('supabase/functions/morning-digest/index.ts');
  const digestList = [...(digest.match(/DIGEST_COUNTRY_ONLY = new Set\(\[([\s\S]*?)\]\)/)?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]);
  ok('the digest\'s country list is the client\'s COUNTRY_ONLY list',
    JSON.stringify([...digestList].sort()) === JSON.stringify([...COUNTRY_ONLY_LOCATIONS].sort()), digestList.join('|'));
  const digestCode = strip(digest);
  ok('the digest tells "no address" apart from "unavailable"',
    /weatherMissing === 'unavailable'/.test(digestCode) && /this job has no jobsite address/.test(digestCode) &&
    !/set the project address to enable hyperlocal forecasts/.test(digestCode));
  ok('the digest names the place', /Weather for \$\{escapeHtml\(b\.weatherPlace\)\}/.test(digestCode));

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void main();
