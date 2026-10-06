// validate-dfr-weather.ts — lane DFRWEATHER, 2026-10-06: the daily report fills
// in today's weather by itself again, from OpenWeather.
//
// History this guard has to hold against:
//   • Until 2026-10-02 the report auto-filled from a free hobby service with no
//     licence. That read was removed for content rights and weather was typed.
//   • Before that, a report backfilled for a past day was stamped with TODAY's
//     sky and the "fetched" flag (DFR-WEATHER-DAY).
//   • And a brand-new report read as "unsaved" a second after opening, because
//     the app had filled a field by itself (DFR-DIRTY-AUTOFILL).
//
// THE RULES (each has at least one planted mutation that turns this red):
//   R1  No unlicensed source, ever. The only weather host in the client is
//       api.openweathermap.org, and only inside utils/weatherService.ts.
//   R2  The daily report's only network weather read is
//       readLiveWeatherForDailyReport() in utils/weatherService.ts.
//   R3  Never simulated, never a forecast slot: every failure leaves the block
//       alone. No fallback of any kind.
//   R4  Today only (device calendar day), checked before and after the request,
//       and the reading itself must have been calculated and received today.
//       A saved report is never auto-filled and never overwritten.
//   R5  Typed or dictated weather is never overwritten by an unattended read.
//   R6  What the app filled is marked as the app's (isManual false + source +
//       read time, stored in the weather JSON), and OpenWeather's credit shows
//       wherever that reading shows: screen, PDF, email, client portal, the
//       report log and lists. Never on typed weather.
//   R7  An unattended fill does not make a new report "dirty".
//   R8  Rate-limit discipline: one request per location per 10 minutes; the
//       relay keeps its sign-in check and per-user hourly ceiling for both kinds.
//
// Run:            bun scripts/validate-dfr-weather.ts
// One mutation:   MUTATE=3 bun scripts/validate-dfr-weather.ts   (must exit 1)
// List them:      MUTATE=list bun scripts/validate-dfr-weather.ts
// A plain run ends by planting every mutation in turn and requiring each one
// to turn the guard red (skip with DFR_WEATHER_SKIP_SELFTEST=1).

import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { OPENWEATHER_CREDIT } from '../utils/contentCredits';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const SERVICE = 'utils/weatherService.ts';
const SCREEN = 'app/daily-report.tsx';
const RELAY = 'supabase/functions/weather-forecast/index.ts';
const PDF = 'utils/pdfGenerator.ts';
const EMAIL = 'utils/emailService.ts';
const SNAPSHOT = 'utils/portalSnapshot.ts';
const HYDRATE = 'utils/portalSnapshotHydrate.ts';
const PORTAL = 'marketing/portal/index.html';
const CLIENT_VIEW = 'app/client-view.tsx';
const LOG = 'components/logs/DailyReportLog.tsx';
const PROJECT = 'app/project-detail.tsx';
const WEEKLY = 'app/weekly-snapshot.tsx';
const TYPES = 'types/index.ts';

// ── planted mutations (in memory; SERVICE ones are also imported as a copy) ──
type Mutation = { name: string; rule: string; file: string; from?: string; to?: string; append?: string };
const MUTATIONS: Mutation[] = [
  // R1
  { rule: 'R1', name: 'the screen calls a second weather host itself', file: SCREEN, append: "\nvoid fetch('https://wttr.in/Austin?format=j1');\n" },
  { rule: 'R1', name: 'another client file talks to OpenWeather directly', file: PDF, append: "\nvoid fetch('https://api.openweathermap.org/data/2.5/weather?q=x');\n" },
  // R2
  { rule: 'R2', name: 'the screen reads the forecast as well', file: SCREEN, append: "\nvoid getForecastWithFallback({ city: 'x' }, new Date(), 1);\n" },
  { rule: 'R2', name: 'the screen calls the relay itself', file: SCREEN, append: "\nvoid supabase.functions.invoke('weather-forecast', { body: {} });\n" },
  // R3
  { rule: 'R3', name: 'a failed read falls back to a simulated day', file: SERVICE,
    from: "  if (!reading) return { ok: false, reason: 'unavailable' };\n",
    to: "  if (!reading) { const sim = getSimulatedForecast(new Date(), 1)[0]; return { ok: true, weather: { temperature: `${sim.tempHigh}°F`, conditions: sim.condition, wind: `${sim.windSpeed} mph`, isManual: false, source: 'openweather', readAt: new Date().toISOString() } }; }\n" },
  { rule: 'R3', name: 'the screen uses a simulated forecast', file: SCREEN, append: "\nvoid getSimulatedForecast(new Date(), 1);\n" },
  { rule: 'R3', name: 'a forecast payload is accepted as a current reading', file: SERVICE, from: '  if (data.list !== undefined) return null;\n', to: '' },
  { rule: 'R3', name: 'a reading calculated hours ago is accepted as now', file: SERVICE, from: 'export const CURRENT_WEATHER_MAX_AGE_MS = 2 * 60 * 60 * 1000;', to: 'export const CURRENT_WEATHER_MAX_AGE_MS = 2000 * 60 * 60 * 1000;' },
  // R4
  { rule: 'R4', name: 'the service asks before checking the day', file: SERVICE,
    from: "  if (!canReadLiveWeatherFor(input.reportDay, today())) return { ok: false, reason: 'not_today' };\n  let query", to: '  let query' },
  { rule: 'R4', name: 'the service does not re-check the day after the answer', file: SERVICE,
    from: "  if (!canReadLiveWeatherFor(input.reportDay, day)) return { ok: false, reason: 'not_today' };\n", to: '' },
  { rule: 'R4', name: "yesterday's reading (or cache entry) is accepted today", file: SERVICE,
    from: "  if (localCalendarDay(new Date(reading.fetchedAt)) !== day || localCalendarDay(new Date(reading.observedAt)) !== day) {\n    return { ok: false, reason: 'unavailable' };\n  }\n", to: '' },
  { rule: 'R4', name: 'the unattended read runs on a report for another day', file: SCREEN,
    from: '    if (!reportIsToday) { autoWeatherDayRef.current = null; return; }\n', to: '' },
  { rule: 'R4', name: 'the unattended read runs on a saved report', file: SCREEN, from: '    if (isSavedReport || !project) return;\n', to: '    if (!project) return;\n' },
  { rule: 'R4', name: 'Refresh is offered on a past day', file: SCREEN,
    from: '{!isLocked && reportIsToday && (!isSavedReport ||', to: '{!isLocked && (!isSavedReport ||' },
  { rule: 'R4', name: 'Refresh may overwrite a saved reading', file: SCREEN,
    from: '{!isLocked && reportIsToday && (!isSavedReport || !(weather.temperature || weather.conditions || weather.wind)) && (', to: '{!isLocked && reportIsToday && (' },
  { rule: 'R4', name: 'an answer lands on a report re-dated while it was in flight', file: SCREEN,
    from: '      if (calendarDayOf(reportDateRef.current) !== requestedDay) return;\n', to: '' },
  { rule: 'R4', name: 're-dating an unsaved report keeps the other day\'s reading', file: SCREEN,
    from: '    if (!appWeatherIsMisdated(weather, calendarDayOf(reportDate), carryLabelDay)) return;\n', to: '    return;\n' },
  { rule: 'R4', name: 'a reading is not tied to the day it was read on', file: SERVICE,
    from: '  if (isOpenWeatherReading(w)) return !readOnReportDay(w, reportDay);\n', to: '  if (isOpenWeatherReading(w)) return false;\n' },
  // R5
  { rule: 'R5', name: 'an unattended read replaces typed weather', file: SCREEN, from: '      if (auto && personsWords) return;\n', to: '' },
  { rule: 'R5', name: 'a touched block is fair game for the unattended read', file: SERVICE, from: '  if (touchedByPerson) return false;\n', to: '' },
  { rule: 'R5', name: 'any block is fair game for the unattended read', file: SERVICE, from: '  return empty || isOpenWeatherReading(w);\n}', to: '  return true;\n}' },
  { rule: 'R5', name: 'typing the temperature does not mark the value as typed', file: SCREEN,
    from: 'setWeather(prev => ({ ...prev, temperature: v, isManual: true }))', to: 'setWeather(prev => ({ ...prev, temperature: v }))' },
  { rule: 'R5', name: 'typing the wind does not claim the block', file: SCREEN,
    from: '{ weatherTouchedRef.current = true; setWeather(prev => ({ ...prev, wind: v, isManual: true })); }', to: '{ setWeather(prev => ({ ...prev, wind: v, isManual: true })); }' },
  { rule: 'R5', name: 'dictated weather is stored as a reading', file: SCREEN, from: 'setWeather({ ...parsed.weather, isManual: true });\n      populated.weather', to: 'setWeather({ ...parsed.weather, isManual: false });\n      populated.weather' },
  { rule: 'R5', name: 'Refresh replaces typed weather without asking', file: SCREEN, from: '    if (!typed) { void readLiveWeather(); return; }\n', to: '    void readLiveWeather(); return;\n' },
  { rule: 'R5', name: 'the misdated clear touches typed weather', file: SERVICE, from: '  if (w.isManual !== false) return false;\n  if (!(w.temperature', to: '  if (!(w.temperature' },
  { rule: 'R5', name: 'the misdated clear rewrites a saved report', file: SCREEN,
    from: '    if (existingReport) return;\n    if (!appWeatherIsMisdated(', to: '    if (!appWeatherIsMisdated(' },
  // R6
  { rule: 'R6', name: 'typed weather with a leftover source counts as a reading', file: SERVICE, from: '  if (!w || w.isManual !== false) return false;\n', to: '  if (!w) return false;\n' },
  { rule: 'R6', name: 'a value with no stored read time counts as a reading', file: SERVICE, from: "  if (w.source !== 'openweather' || !w.readAt) return false;\n", to: '' },
  { rule: 'R6', name: 'the stored read time is the time of asking, not of the read', file: SERVICE, from: '      readAt: new Date(reading.fetchedAt).toISOString(),\n', to: '      readAt: new Date(now()).toISOString(),\n' },
  { rule: 'R6', name: 'the screen credits OpenWeather on typed weather', file: SCREEN, from: 'days={weatherFromOpenWeather ? DFR_CREDIT_LIVE : DFR_CREDIT_NONE}', to: 'days={DFR_CREDIT_LIVE}' },
  { rule: 'R6', name: 'the screen drops the credit', file: SCREEN, from: '<WeatherCredit days={weatherFromOpenWeather ? DFR_CREDIT_LIVE : DFR_CREDIT_NONE} style={styles.weatherCredit} />', to: '' },
  { rule: 'R6', name: 'the provenance line is not rendered', file: SCREEN, from: '<Text style={styles.weatherProvenance} testID="dfr-weather-provenance">{weatherProvenance}</Text>', to: '' },
  { rule: 'R6', name: 'a typed block keeps its OpenWeather stamp when saved', file: SERVICE,
    from: '  return { temperature: w.temperature, conditions: w.conditions, wind: w.wind, isManual: w.isManual };\n}', to: '  return w;\n}' },
  { rule: 'R6', name: 'one save path stores the block unsettled', file: SCREEN, from: "        date: reportDate,  // honor the user-picked date on edit too\n        weather: settleDfrWeather(weather),", to: "        date: reportDate,  // honor the user-picked date on edit too\n        weather," },
  { rule: 'R6', name: 'the PDF prints the reading without the credit', file: PDF, from: '. ${escHtml(OPENWEATHER_CREDIT)}.</p>`', to: '.</p>`' },
  { rule: 'R6', name: 'the PDF drops the source line', file: PDF, from: '  ]) + dfrWeatherSourceHtml(dfr);', to: '  ]);' },
  { rule: 'R6', name: 'the email drops the source row', file: EMAIL, from: '      ${weatherSourceRow}\n', to: '' },
  { rule: 'R6', name: 'the portal payload drops the source', file: SNAPSHOT, from: '{ weatherSource: dfrWeatherSourceLine(dfr.weather, calendarDayOf(dfr.date)), weatherReadAt: dfr.weather.readAt }', to: '{}' },
  { rule: 'R6', name: 'the portal page credits OpenWeather on typed weather', file: PORTAL, from: '(d.weather && d.weatherSource\n', to: '(d.weather\n' },
  { rule: 'R6', name: 'the portal page drops the credit', file: PORTAL, from: 'Weather data provided by OpenWeather</a></div>', to: '</a></div>' },
  { rule: 'R6', name: 'the client view drops the credit', file: CLIENT_VIEW, from: 'days={dailyReports.slice(0, 5).some(r => isOpenWeatherReading(r.weather)) ? [{ source: \'live\' }] : []}', to: 'days={[]}' },
  { rule: 'R6', name: 'the report log drops the credit under the table', file: LOG, from: "<WeatherCredit days={anyOpenWeather ? [{ source: 'live' }] : []} />", to: '' },
  { rule: 'R6', name: 'the source no longer fits in the weather JSON', file: TYPES, from: "  source?: 'openweather';\n", to: '' },
  // R7
  { rule: 'R7', name: "the app's own fill reads as the super's edit", file: SCREEN, from: '      if (!personsWords) setAutoFilled(p => ({ ...p, weather: result.weather }));\n', to: '' },
  { rule: 'R7', name: 'the unsaved-work baseline ignores what the app filled', file: SCREEN, from: 'weather: existingReport?.weather ?? autoFilled.weather ?? EMPTY_DFR_WEATHER,', to: 'weather: existingReport?.weather ?? EMPTY_DFR_WEATHER,' },
  // R8
  { rule: 'R8', name: 'the current-conditions cache is switched off', file: SERVICE,
    from: '  if (cached && now - cached.fetchedAt >= 0 && now - cached.fetchedAt < WEATHER_CACHE_TTL_MS) return cached;\n', to: '' },
  { rule: 'R8', name: 'a dead location is re-asked at once', file: SERVICE,
    from: '  if (failedAt != null && now - failedAt >= 0 && now - failedAt < WEATHER_FAILURE_TTL_MS) return null;\n\n  try {\n    const reading', to: '  try {\n    const reading' },
  { rule: 'R8', name: 'the unattended read fires on every render', file: SCREEN, from: '    if (autoWeatherDayRef.current === carryLabelDay) return;\n', to: '' },
  { rule: 'R8', name: 'the relay skips the hourly ceiling for current conditions', file: RELAY,
    from: 'const hourly = await rateLimitCount(`weather-forecast:user:${auth.userId}`);', to: "const hourly = parseKind(body) === 'current' ? 1 : await rateLimitCount(`weather-forecast:user:${auth.userId}`);" },
  { rule: 'R8', name: 'the relay answers current conditions before the sign-in check', file: RELAY,
    from: "  const auth = await requireTier(req, ['free', 'pro', 'business', 'enterprise'], 'weather_forecast');\n  if (!auth.ok) return json(auth.body, auth.status);\n", to: "  const auth = { ok: true as const, userId: 'x', body: null, status: 200 };\n" },
  { rule: 'R8', name: 'a current reading is served from the forecast cache slot', file: RELAY, from: '  const key = `${kind}:${cacheKey(query)}`;', to: '  const key = cacheKey(query);' },
];

const MUTATE_ARG = process.env.MUTATE || '';
if (MUTATE_ARG === 'list') {
  MUTATIONS.forEach((m, i) => console.log(`${i + 1}. [${m.rule}] ${m.name} (${m.file})`));
  process.exit(0);
}
const MUTATE = Number(MUTATE_ARG || 0);
const planted: Mutation | null = MUTATE ? MUTATIONS[MUTATE - 1] ?? null : null;
if (MUTATE && !planted) { console.error('unknown MUTATE'); process.exit(2); }

const cache = new Map<string, string>();
function read(rel: string): string {
  const hit = cache.get(rel);
  if (hit !== undefined) return hit;
  let text = readFileSync(join(ROOT, rel), 'utf8');
  if (planted && planted.file === rel) {
    if (planted.append !== undefined) text += planted.append;
    else {
      if (!text.includes(planted.from as string)) { console.error(`MUTATE=${MUTATE}: anchor not found in ${rel}`); process.exit(3); }
      text = text.replace(planted.from as string, planted.to as string);
    }
  }
  cache.set(rel, text);
  return text;
}
if (planted) { read(planted.file); console.log(`(planted mutation ${MUTATE}: [${planted.rule}] ${planted.name})`); }

/** JSX comments go whole, then block comments, then whole-line `//` comments. */
const stripComments = (src: string) => src
  .replace(/\{\s*\/\*(?:(?!\*\/)[\s\S])*\*\/\s*\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');
const code = (rel: string) => stripComments(read(rel));
const count = (src: string, re: RegExp) => (src.match(re) ?? []).length;

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail = ''): void {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`); }
}
const section = (s: string) => console.log(`\n${s}`);

type Service = typeof import('../utils/weatherService');
/** The service as the mutation left it. A copy next to the original, so its
 *  lazy `require('./geocodeProject')` resolves exactly as the original's does. */
async function loadService(): Promise<Service> {
  if (!planted || planted.file !== SERVICE) return import('../utils/weatherService');
  const file = join(ROOT, 'utils', `.mut-weatherService-${process.pid}.ts`);
  writeFileSync(file, read(SERVICE));
  try { return await import(file) as Service; } finally { try { unlinkSync(file); } catch { /* gone */ } }
}

// Local-time instants, so every day comparison below holds in any timezone.
const at = (d: number, h: number, m: number) => new Date(2026, 9, d, h, m, 0, 0).getTime();
const DAY6 = '2026-10-06';
const DAY7 = '2026-10-07';
const SITE = { city: '120 Main St, Austin, TX', latitude: 30.2672, longitude: -97.7431 };
const payload = (dtMs: number, over: Record<string, unknown> = {}) => ({
  cod: 200, dt: Math.floor(dtMs / 1000), name: 'Austin',
  main: { temp: 71.6 }, weather: [{ main: 'Rain', description: 'light rain' }], wind: { speed: 8.4, deg: 315 },
  ...over,
});

async function main(): Promise<void> {
  const S = await loadService();
  const service = code(SERVICE);
  const dfr = code(SCREEN);

  // ═══════════════════════════════════════════════════════════════════════
  section('A. The read itself (utils/weatherService, run for real)');
  {
    let asked = 0;
    let reply: unknown = payload(at(6, 15, 40));
    S.__setCurrentWeatherTransportForTests(async () => { asked++; if (reply instanceof Error) throw reply; return reply as never; });
    const run = (o: { reportDay?: string | null; today?: string | (() => string); now: number; location?: typeof SITE | { city?: string; latitude?: number; longitude?: number } }) =>
      S.readLiveWeatherForDailyReport({
        reportDay: o.reportDay === undefined ? DAY6 : o.reportDay,
        today: typeof o.today === 'function' ? o.today : () => (o.today as string | undefined) ?? DAY6,
        now: () => o.now,
        location: o.location ?? SITE,
      });

    // R4 + R6: the happy path.
    const first = await run({ now: at(6, 15, 42) });
    ok("R4: a report dated today, with a jobsite, gets today's reading", first.ok === true, JSON.stringify(first));
    if (first.ok) {
      ok("R6: it is marked as the app's (isManual false, source openweather)", first.weather.isManual === false && first.weather.source === 'openweather');
      ok('R6: the read time is stored, and it is the time of the read', first.weather.readAt === new Date(at(6, 15, 42)).toISOString(), first.weather.readAt);
      ok('the three strings read like a typed report (71.6 → 72°F, Light rain, 8 mph NW)',
        first.weather.temperature === '72°F' && first.weather.conditions === 'Light rain' && first.weather.wind === '8 mph NW',
        JSON.stringify(first.weather));
      ok('R6: isOpenWeatherReading says yes to it', S.isOpenWeatherReading(first.weather));
    }
    // R8: the cache.
    const again = await run({ now: at(6, 15, 47) });
    ok('R8: a second read 5 minutes later makes no second request', asked === 1, `${asked} requests`);
    ok('R6: ...and keeps the ORIGINAL read time, never the time of asking',
      again.ok === true && first.ok === true && again.weather.readAt === first.weather.readAt);
    reply = payload(at(6, 15, 58), { main: { temp: 65 } });
    const later = await run({ now: at(6, 15, 59) });
    ok('R8: after 10 minutes it asks again', asked === 2 && later.ok === true && later.ok && later.weather.temperature === '65°F', `${asked} requests`);

    // R4: other days never reach the network.
    S.__setCurrentWeatherTransportForTests(async () => { asked++; return reply as never; });
    asked = 0;
    reply = payload(at(6, 15, 40));
    const past = await run({ reportDay: '2026-10-05', now: at(6, 15, 42) });
    ok('R4: a report for yesterday is refused', past.ok === false && past.reason === 'not_today', JSON.stringify(past));
    const future = await run({ reportDay: DAY7, now: at(6, 15, 42) });
    ok('R4: a report for tomorrow is refused (a forecast is not an observation)', future.ok === false && future.reason === 'not_today');
    const noDay = await run({ reportDay: null, now: at(6, 15, 42) });
    ok('R4: an unreadable report day is refused', noDay.ok === false && noDay.reason === 'not_today');
    ok('R4: ...and none of the three made a request', asked === 0, `${asked} requests`);

    // R4: midnight passes while the request is in flight.
    let calls = 0;
    reply = payload(at(6, 23, 58));
    const rolled = await run({ today: () => (calls++ === 0 ? DAY6 : DAY7), now: at(6, 23, 59) });
    ok('R4: the day is re-checked after the answer (midnight passed in flight)', rolled.ok === false && rolled.reason === 'not_today', JSON.stringify(rolled));

    // R4: a reading from yesterday, and a cache entry from yesterday.
    S.__setCurrentWeatherTransportForTests(async () => { asked++; return reply as never; });
    reply = payload(at(6, 23, 50));
    const stale = await run({ reportDay: DAY7, today: DAY7, now: at(7, 0, 4) });
    ok("R4: a reading OpenWeather calculated yesterday is refused for today's report", stale.ok === false && stale.reason === 'unavailable', JSON.stringify(stale));
    S.__setCurrentWeatherTransportForTests(async () => { asked++; return reply as never; });
    const lastNight = await run({ now: at(6, 23, 56) });
    const cachedOver = await run({ reportDay: DAY7, today: DAY7, now: at(7, 0, 2) });
    ok('R4: a cache entry read last night is refused after midnight', lastNight.ok === true && cachedOver.ok === false, JSON.stringify(cachedOver));

    // R4: no location.
    asked = 0;
    S.__setCurrentWeatherTransportForTests(async () => { asked++; return payload(at(6, 15, 40)) as never; });
    const blank = await run({ now: at(6, 15, 42), location: { city: '' } });
    const country = await run({ now: at(6, 15, 42), location: { city: 'United States', latitude: 39.8283, longitude: -98.5795 } });
    ok('a job with no address is refused (no_location)', blank.ok === false && blank.reason === 'no_location');
    ok('a country on its own is no location, whatever coordinates it carries', country.ok === false && country.reason === 'no_location');
    ok('...and neither made a request', asked === 0, `${asked} requests`);

    // R3: every failure is a refusal, never a value.
    const bad: [string, unknown][] = [
      ['no answer (no key, no signal)', null],
      ['the transport throws', new Error('offline')],
      ['OpenWeather says 401', { cod: 401, message: 'Invalid API key' }],
      ['a forecast payload answers instead (a relay not yet redeployed)', { cod: '200', list: [{ dt: 1, main: { temp_max: 70, temp_min: 60 }, weather: [{ main: 'Clear', description: 'clear sky' }], wind: { speed: 3 } }], city: { name: 'Austin', timezone: -18000 } }],
      ['a forecast payload that also carries a temperature', payload(at(6, 15, 40), { list: [] })],
      ['no temperature', payload(at(6, 15, 40), { main: {} })],
      ['a temperature that is not a number', payload(at(6, 15, 40), { main: { temp: 'warm' } })],
      ['no observation time', payload(at(6, 15, 40), { dt: undefined })],
      ['no words for the sky', payload(at(6, 15, 40), { weather: [] })],
      ['a reading calculated three hours ago', payload(at(6, 12, 30))],
    ];
    for (const [label, body] of bad) {
      S.__setCurrentWeatherTransportForTests(async () => { if (body instanceof Error) throw body; return body as never; });
      const r = await run({ now: at(6, 15, 42) });
      ok(`R3: ${label} → nothing is filled`, r.ok === false && r.reason === 'unavailable' && !('weather' in r), JSON.stringify(r));
    }
    // R8: a failed location is not hammered.
    let failing = 0;
    S.__setCurrentWeatherTransportForTests(async () => { failing++; return null; });
    await run({ now: at(6, 15, 42) });
    await run({ now: at(6, 15, 42) + 20_000 });
    ok('R8: a location that just failed is not asked again within a minute', failing === 1, `${failing} requests`);
    S.__setCurrentWeatherTransportForTests(null);

    const calm = S.formatCurrentForReport({ tempF: -3.4, description: 'clear sky', windMph: 0.4, windDeg: null, observedAt: 0, fetchedAt: 0 });
    ok('still air reads "Calm", a missing direction prints none, and a negative temperature keeps its sign',
      calm.wind === 'Calm' && calm.temperature === '-3°F'
      && S.formatCurrentForReport({ tempF: 50, description: 'mist', windMph: 12, windDeg: null, observedAt: 0, fetchedAt: 0 }).wind === '12 mph');
  }

  // ═══════════════════════════════════════════════════════════════════════
  section('B. Whose words are in the block (pure rules)');
  {
    const READ = { temperature: '72°F', conditions: 'Light rain', wind: '8 mph NW', isManual: false, source: 'openweather' as const, readAt: new Date(at(6, 15, 42)).toISOString() };
    const TYPED = { temperature: '70', conditions: 'Drizzle', wind: '', isManual: true };
    const EMPTY = { temperature: '', conditions: '', wind: '', isManual: true };
    const LEGACY = { temperature: '71°F / 22°C', conditions: 'Clear', wind: '5 mph NW', isManual: false };

    ok('R5: an unattended read may fill an empty, untouched block', S.autoReadMayWrite(EMPTY, false));
    ok("R5: ...and refresh the app's own earlier reading", S.autoReadMayWrite(READ, false));
    ok('R5: it may never replace typed weather', !S.autoReadMayWrite(TYPED, false));
    ok('R5: it may never write to a block a person has touched, even one typed and erased', !S.autoReadMayWrite(EMPTY, true) && !S.autoReadMayWrite(READ, true));
    ok('R5: a value with no source is not provably the app\'s, so it is left alone', !S.autoReadMayWrite(LEGACY, false));

    ok('R6: typed weather is not an OpenWeather reading', !S.isOpenWeatherReading(TYPED));
    ok('R6: typed over a reading (source left on the object) is not one either', !S.isOpenWeatherReading({ ...READ, temperature: '75', isManual: true }));
    ok('R6: isManual false with no source or no read time is not one', !S.isOpenWeatherReading(LEGACY) && !S.isOpenWeatherReading({ ...READ, readAt: undefined }) && !S.isOpenWeatherReading({ ...READ, readAt: 'soon' }));
    ok('R6: a read time with no source, or any other source, is not one',
      !S.isOpenWeatherReading({ ...READ, source: undefined }) && !S.isOpenWeatherReading({ ...READ, source: 'some-other-service' }));
    ok('R6: an empty block is not one', !S.isOpenWeatherReading({ ...READ, temperature: '', conditions: '', wind: '' }));

    const settledTyped = S.settleDfrWeather({ ...READ, temperature: '75', isManual: true });
    ok('R6: saving typed-over weather drops the OpenWeather stamp', settledTyped.isManual === true && !('source' in settledTyped) && !('readAt' in settledTyped), JSON.stringify(settledTyped));
    const settledRead = S.settleDfrWeather(READ);
    ok('R6: saving a reading keeps its source and read time', settledRead.source === 'openweather' && settledRead.readAt === READ.readAt && settledRead.isManual === false);

    ok('R4: a reading belongs to the day it was read on', !S.appWeatherIsMisdated(READ, DAY6, DAY6));
    ok('R4: re-dated to another day, it is misdated', S.appWeatherIsMisdated(READ, '2026-10-05', DAY6) && S.appWeatherIsMisdated(READ, DAY7, DAY7));
    ok("R4: yesterday's draft opened today keeps yesterday's reading under yesterday's date", !S.appWeatherIsMisdated(READ, DAY6, DAY7));
    ok('R5: typed weather is never misdated, on any day', !S.appWeatherIsMisdated(TYPED, '2026-09-01', DAY6) && !S.appWeatherIsMisdated({ ...READ, isManual: true }, '2026-09-01', DAY6));
    ok('an unsourced older value is tolerated only on a report dated today', !S.appWeatherIsMisdated(LEGACY, DAY6, DAY6) && S.appWeatherIsMisdated(LEGACY, '2026-10-05', DAY6));
    ok('an empty block is never misdated', !S.appWeatherIsMisdated({ ...EMPTY, isManual: false }, '2026-10-05', DAY6));

    const kind = (o: Partial<Parameters<Service['weatherProvenanceKind']>[0]>) =>
      S.weatherProvenanceKind({ isManual: false, reportIsToday: true, hasValue: true, ...o });
    ok('provenance: an empty block says nothing', kind({ hasValue: false }) === 'none' && S.weatherProvenanceLine({ isManual: false, reportIsToday: true, hasValue: false }) === '');
    ok('provenance: typed says typed, even with a source left behind', kind({ isManual: true, source: 'openweather', readAtLabel: '3:42 PM' }) === 'typed');
    ok('R6: a reading names its source and its time',
      S.weatherProvenanceLine({ isManual: false, reportIsToday: true, hasValue: true, source: 'openweather', readAtLabel: '3:42 PM' }) === 'From OpenWeather at 3:42 PM.');
    ok('provenance: a reading under a different day says so', kind({ source: 'openweather', readAtLabel: '3:42 PM', readOnReportDay: false }) === 'openweather_other_day');
    ok('provenance: a value with no stored source never claims one',
      kind({}) === 'saved_today' && kind({ reportIsToday: false }) === 'saved_past' && kind({ source: 'openweather' }) === 'saved_today'
      && !/OpenWeather/.test(S.weatherProvenanceLine({ isManual: false, reportIsToday: true, hasValue: true })));

    ok('R6: the printed source line exists only for a reading', S.dfrWeatherSourceLine(TYPED, DAY6) === '' && S.dfrWeatherSourceLine(LEGACY, DAY6) === '' && S.dfrWeatherSourceLine(null, DAY6) === '');
    ok('R6: ...and reads "From OpenWeather at 3:42 PM"', S.dfrWeatherSourceLine(READ, DAY6) === 'From OpenWeather at 3:42 PM', S.dfrWeatherSourceLine(READ, DAY6));
    ok('R6: ...and names the day when the report is dated another one', /^From OpenWeather on Oct 6, 2026 at 3:42 PM$/.test(S.dfrWeatherSourceLine(READ, '2026-10-05')), S.dfrWeatherSourceLine(READ, '2026-10-05'));
    for (const s of [
      S.weatherProvenanceLine({ isManual: true, reportIsToday: true, hasValue: true }),
      S.weatherProvenanceLine({ isManual: false, reportIsToday: true, hasValue: true }),
      S.weatherProvenanceLine({ isManual: false, reportIsToday: false, hasValue: true }),
      S.weatherProvenanceLine({ isManual: false, reportIsToday: true, hasValue: true, source: 'openweather', readAtLabel: '3:42 PM', readOnReportDay: false }),
      S.backfilledWeatherNotice('Mon, Sep 14'),
    ]) ok(`copy: no dash as punctuation, no "&", no "e.g.", no arrow: "${s.slice(0, 40)}"`, !/[—–&→]|e\.g\./.test(s));
  }

  // ═══════════════════════════════════════════════════════════════════════
  section('C. The service has one licensed source and no fallback (source)');
  {
    const start = service.indexOf("const OPENWEATHER_CURRENT_ENDPOINT = 'https://api.openweathermap.org/data/2.5/weather';");
    const end = service.indexOf('export function canReadLiveWeatherFor(');
    const half = start >= 0 && end > start ? service.slice(start, end) : '';
    ok('the current-conditions half is where it is expected', half.length > 0);
    ok('R3: nothing in it simulates, pads or reads the forecast',
      half.length > 0 && !/getSimulatedForecast|padWithSimulated|getForecastWithFallback|getOpenWeatherForecast|condenseToDaily/.test(half));
    ok('R1: the service talks to api.openweathermap.org and to no other host',
      (service.match(/https?:\/\/[a-z0-9.-]+/gi) ?? []).every((u) => /^https:\/\/(api\.openweathermap\.org|openweathermap\.org)$/i.test(u)),
      (service.match(/https?:\/\/[a-z0-9.-]+/gi) ?? []).join(', '));
    ok('R8: both kinds share one 10-minute cache window', /const WEATHER_CACHE_TTL_MS = 10 \* 60 \* 1000;/.test(service) && count(service, /WEATHER_CACHE_TTL_MS/g) === 3);
    ok('the relay is asked for the current kind by name', /invoke\('weather-forecast', \{ body: \{ \.\.\.location, kind: 'current' \} \}\)/.test(service));

    // R1: no other client file may reach a weather host.
    const clientFiles = [SCREEN, PDF, EMAIL, SNAPSHOT, HYDRATE, CLIENT_VIEW, LOG, PROJECT, WEEKLY, 'components/schedule/SimulatedWeatherNotice.tsx', 'utils/contentCredits.ts'];
    const offenders = clientFiles.filter((f) => /api\.openweathermap\.org|wttr\.in|open-meteo|weatherapi\.com|api\.weather\.gov|tomorrow\.io|visualcrossing/i.test(code(f)));
    ok('R1: only utils/weatherService.ts reaches a weather API, and none is an unlicensed one', offenders.length === 0, offenders.join(', '));
  }

  // ═══════════════════════════════════════════════════════════════════════
  section('D. The daily report screen (source)');
  {
    ok('R1: the screen names no unlicensed weather service (code, comments or copy)', !/wttr/i.test(read(SCREEN)));
    ok('R1 + R2: the screen makes no request of its own for weather',
      !/\bfetch\(\s*[`'"]https?:/.test(dfr) && !/functions\.invoke\('weather-forecast'/.test(dfr));
    ok('R2: its one weather read is readLiveWeatherForDailyReport, called once',
      count(dfr, /readLiveWeatherForDailyReport\(/g) === 1 && /from '@\/utils\/weatherService';/.test(dfr));
    ok('R2 + R3: it never calls the forecast, the simulator or the raw current read',
      !/getForecastWithFallback|getOpenWeatherForecast|getSimulatedForecast|getOpenWeatherCurrent|condenseToDaily/.test(dfr));

    ok('R4: "today" is the calendar-day guard, re-read on focus',
      /const reportIsToday = useMemo\(\s*\(\) => canReadLiveWeatherFor\(calendarDayOf\(reportDate\), carryLabelDay\),/.test(dfr));
    ok('R4: the read is asked for the report\'s own day and today is read from the clock each time',
      /const requestedDay = calendarDayOf\(reportDateRef\.current\);/.test(dfr) && /reportDay: requestedDay,\s*today: \(\) => todayCalendarDay\(\),/.test(dfr));
    ok('R4: an answer for a report re-dated in flight is dropped',
      /if \(calendarDayOf\(reportDateRef\.current\) !== requestedDay\) return;/.test(dfr));
    ok('R4: the unattended read is for today only',
      /useEffect\(\(\) => \{\s*if \(!reportIsToday\) \{ autoWeatherDayRef\.current = null; return; \}/.test(dfr));
    ok('R4: ...and never for a saved report (route id, saved record, or one saved in this session)',
      /if \(isSavedReport \|\| !project\) return;/.test(dfr) && /const isSavedReport = Boolean\(reportId \|\| existingReport \|\| persistedSelf\);/.test(dfr));
    ok('R8: ...and once per open and day, not once per render',
      /if \(autoWeatherDayRef\.current === carryLabelDay\) return;\s*autoWeatherDayRef\.current = carryLabelDay;\s*void readLiveWeather\(\{ auto: true \}\);/.test(dfr)
      && count(dfr, /readLiveWeather\(\{ auto: true \}\)/g) === 1);
    ok('R4: Refresh is offered for today only, and on a saved report only while its weather is empty',
      /\{!isLocked && reportIsToday && \(!isSavedReport \|\| !\(weather\.temperature \|\| weather\.conditions \|\| weather\.wind\)\) && \(\s*<TouchableOpacity[\s\S]{0,400}testID="dfr-weather-refresh"/.test(dfr));
    ok('R4: an unsaved report re-dated away from its reading loses the reading, and only then',
      /useEffect\(\(\) => \{\s*if \(existingReport\) return;\s*if \(!appWeatherIsMisdated\(weather, calendarDayOf\(reportDate\), carryLabelDay\)\) return;\s*setWeather\(EMPTY_DFR_WEATHER\);/.test(dfr));

    ok('R5: every typed weather field claims the block and marks the value as typed',
      (['temperature', 'conditions', 'wind'] as const).every((f) =>
        dfr.includes(`{ weatherTouchedRef.current = true; setWeather(prev => ({ ...prev, ${f}: v, isManual: true })); }`)));
    ok('R5: an unattended read never replaces a person\'s words',
      /const personsWords = !autoReadMayWrite\(weatherRef\.current, weatherTouchedRef\.current\);\s*if \(auto && personsWords\) return;/.test(dfr));
    ok('R5: dictated weather claims the block and is the super\'s own account (isManual: true)',
      /weatherTouchedRef\.current = true;\s*setWeather\(\{ \.\.\.parsed\.weather, isManual: true \}\);\s*populated\.weather/.test(dfr) && !/isManual: false/.test(dfr));
    ok('R5: Refresh asks before replacing typed weather',
      /const typed = cur\.isManual && Boolean\(cur\.temperature \|\| cur\.conditions \|\| cur\.wind\);\s*if \(!typed\) \{ void readLiveWeather\(\); return; \}\s*showAlert\(/.test(dfr)
      && /'Keep Mine'\), style: 'cancel' \}/.test(dfr));
    ok('R5: a restored draft the super typed claims the block', /if \(draft\.weather\?\.isManual && [^\n]+\{\s*weatherTouchedRef\.current = true;\s*\}\s*setWeather\(draft\.weather\);/.test(dfr));

    ok('R6: the provenance line is built from the stored source and read time',
      /weatherProvenanceKind\(\{[\s\S]{0,300}source: weather\.source,[\s\S]{0,200}weather\.readAt/.test(dfr)
      && /'From OpenWeather at \{time\}\.'/.test(dfr) && /'Typed by hand\.'/.test(dfr));
    ok('R6: ...and it is on screen', dfr.includes('<Text style={styles.weatherProvenance} testID="dfr-weather-provenance">{weatherProvenance}</Text>'));
    ok('R6: the credit shows for a reading the app took, and only then',
      /const weatherFromOpenWeather = isOpenWeatherReading\(weather\);/.test(dfr)
      && dfr.includes('<WeatherCredit days={weatherFromOpenWeather ? DFR_CREDIT_LIVE : DFR_CREDIT_NONE} style={styles.weatherCredit} />')
      && /const DFR_CREDIT_NONE = \[\] as const;/.test(dfr));
    ok('R6: every path that stores or prints the report settles the weather block first',
      count(dfr, /weather: settleDfrWeather\(weather\),/g) === 4 && !/^\s*weather,\s*$/m.test(dfr),
      `${count(dfr, /weather: settleDfrWeather\(weather\),/g)} settled saves`);
    ok('no fake value is seeded: the empty block is empty and typed',
      /const EMPTY_DFR_WEATHER: DFRWeather = \{ temperature: '', conditions: '', wind: '', isManual: true \};/.test(dfr));
    ok('at most one quiet line, only while the block is empty',
      count(dfr, /testID="dfr-weather-quiet-line"/g) === 1
      && /\{!isLocked && !\(weather\.temperature \|\| weather\.conditions \|\| weather\.wind\) && \(!reportIsToday \|\| liveWeatherMissing\) \? \(/.test(dfr));

    ok("R7: a fill that replaced nothing a person wrote joins the unsaved-work baseline",
      /if \(!personsWords\) setAutoFilled\(p => \(\{ \.\.\.p, weather: result\.weather \}\)\);/.test(dfr));
    ok('R7: ...and the baseline reads it', /weather: existingReport\?\.weather \?\? autoFilled\.weather \?\? EMPTY_DFR_WEATHER,/.test(dfr));
    ok('R7: clearing a misdated reading moves the baseline with it',
      /setWeather\(EMPTY_DFR_WEATHER\);\s*setAutoFilled\(p => \(\{ \.\.\.p, weather: EMPTY_DFR_WEATHER \}\)\);/.test(dfr));
  }

  // ═══════════════════════════════════════════════════════════════════════
  section('E. Where the reading travels, the source and the credit travel');
  {
    const types = code(TYPES);
    const block = /export interface DFRWeather \{[\s\S]*?\n\}/.exec(types)?.[0] ?? '';
    ok('the source and read time live inside the weather JSON (no new column)',
      /source\?: 'openweather';/.test(block) && /readAt\?: string;/.test(block) && /isManual: boolean;/.test(block), block);

    const pdf = code(PDF);
    ok('PDF: the source line and the credit print under the weather figures',
      pdf.includes("  ]) + dfrWeatherSourceHtml(dfr);")
      && /const line = dfrWeatherSourceLine\(dfr\.weather, dfrCalendarDayOf\(dfr\.date\)\);\s*if \(!line\) return '';/.test(pdf)
      && pdf.includes('${escHtml(line)}. ${escHtml(OPENWEATHER_CREDIT)}.</p>`'));
    const email = code(EMAIL);
    ok('email: the source row carries the credit, and exists only for a reading',
      /const weatherSource = dfrWeatherSourceLine\(weather, reportDay\);/.test(email)
      && /const weatherSourceRow = weatherSource\s*\? emailStatRow\('Weather Source', [^\n]*OPENWEATHER_URL[^\n]*OPENWEATHER_CREDIT/.test(email)
      && email.includes('      ${weatherSourceRow}\n'));
    ok('email: the screen hands it the settled block', dfr.includes('weather: { ...settleDfrWeather(weather), conditions:'));
    const snap = code(SNAPSHOT);
    ok('portal payload: the source travels only with a reading',
      snap.includes('...(weather && dfrWeatherSourceLine(dfr.weather, calendarDayOf(dfr.date))')
      && snap.includes('{ weatherSource: dfrWeatherSourceLine(dfr.weather, calendarDayOf(dfr.date)), weatherReadAt: dfr.weather.readAt }'));
    ok('client view rebuild: a hydrated report is a reading only when the payload said so',
      /\.\.\.\(d\.weatherSource && d\.weatherReadAt \? \{ source: 'openweather' as const, readAt: d\.weatherReadAt \} : \{\}\)/.test(code(HYDRATE)));
    const portal = read(PORTAL);
    ok('portal page: the credit prints with the source, linked, and only when the payload carries one',
      portal.includes("(d.weather && d.weatherSource\n")
      && portal.includes(`'<div class="dfr-weather-source">'+esc(d.weatherSource)+'. <a href="https://openweathermap.org/" target="_blank" rel="noopener noreferrer">${OPENWEATHER_CREDIT}</a></div>'`)
      && count(portal, new RegExp(OPENWEATHER_CREDIT, 'g')) === 1);
    ok('client view: credit under the reports when one shows a reading',
      code(CLIENT_VIEW).includes("days={dailyReports.slice(0, 5).some(r => isOpenWeatherReading(r.weather)) ? [{ source: 'live' }] : []}"));
    const log = code(LOG);
    ok('report log: the open record prints the source and the credit, the table carries the credit',
      /const weatherSource = dfrWeatherSourceLine\(r\.weather, row\.day\);/.test(log)
      && log.includes("<WeatherCredit days={weatherParts.length && weatherSource ? [{ source: 'live' }] : []} />")
      && log.includes("<WeatherCredit days={anyOpenWeather ? [{ source: 'live' }] : []} />")
      && /const anyOpenWeather = rows\.some\(\(r\) => isOpenWeatherReading\(r\.report\.weather\)\);/.test(log));
    ok('project page list: credit when a row shows a reading',
      code(PROJECT).includes("<WeatherCredit days={dailyReports.some(dr => isOpenWeatherReading(dr.weather)) ? [{ source: 'live' }] : []} />"));
    ok('weekly snapshot: credit when a reading feeds the weather card',
      code(WEEKLY).includes("<WeatherCredit days={weekDfrs.some(d => isOpenWeatherReading(d.weather)) ? [{ source: 'live' }] : []} />"));
    ok('the credit component still prints nothing without a live day',
      /if \(!showsOpenWeatherCredit\(days\)\) return null;/.test(code('components/schedule/SimulatedWeatherNotice.tsx')));
  }

  // ═══════════════════════════════════════════════════════════════════════
  section('F. The relay (supabase/functions/weather-forecast)');
  {
    const fn = code(RELAY);
    const iAuth = fn.indexOf("const auth = await requireTier(req, ['free', 'pro', 'business', 'enterprise'], 'weather_forecast');");
    const iGate = fn.indexOf('if (!auth.ok) return json(auth.body, auth.status);');
    const iRate = fn.indexOf('const hourly = await rateLimitCount(`weather-forecast:user:${auth.userId}`);');
    const iLimit = fn.indexOf('if (hourly - 1 >= HOURLY_LIMIT)');
    const iBranch = fn.indexOf("if (kind === 'current') {");
    ok('R8: one sign-in check and one hourly ceiling, both before either kind is answered',
      iAuth > 0 && iGate > iAuth && iRate > iGate && iLimit > iRate && iBranch > iLimit
      && count(fn, /requireTier\(/g) === 1 && count(fn, /rateLimitCount\(/g) === 1,
      JSON.stringify({ iAuth, iGate, iRate, iLimit, iBranch }));
    ok('R1: it reaches OpenWeather and nothing else',
      (fn.match(/https?:\/\/[a-z0-9.-]+/gi) ?? []).every((u) => /^https:\/\/(api\.openweathermap\.org|deno\.land)$/i.test(u))
      && /const OPENWEATHER_CURRENT_ENDPOINT = 'https:\/\/api\.openweathermap\.org\/data\/2\.5\/weather';/.test(fn));
    ok('R8: the two kinds are cached apart', fn.includes('const key = `${kind}:${cacheKey(query)}`;'));
    ok('no `kind`, or an unknown one, is the forecast exactly as before',
      /\(body as Record<string, unknown>\)\.kind === 'current' \? 'current' : 'forecast'/.test(fn));
    ok('a current answer is refused unless it has a time and a numeric temperature',
      /typeof now\.dt !== 'number' \|\| typeof now\.main\?\.temp !== 'number'/.test(fn));
    ok('the key never leaves the server', /Deno\.env\.get\('OPENWEATHER_API_KEY'\)/.test(fn) && !/EXPO_PUBLIC/.test(fn) && !/json\([^)]*\burl\b/.test(fn));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.error('\n✗ validate-dfr-weather: the daily report weather rules do not hold.\n');
    process.exit(1);
  }

  // ── every planted mutation must turn this guard red ───────────────────────
  if (!planted && process.env.DFR_WEATHER_SKIP_SELFTEST !== '1') {
    section(`G. Each of the ${MUTATIONS.length} planted mutations turns the guard red`);
    const survivors: string[] = [];
    for (let i = 0; i < MUTATIONS.length; i++) {
      const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
        cwd: ROOT, env: { ...process.env, MUTATE: String(i + 1) }, encoding: 'utf8',
      });
      if (r.status !== 1) survivors.push(`${i + 1}. [${MUTATIONS[i].rule}] ${MUTATIONS[i].name} (exit ${r.status})`);
    }
    const rules = new Set(MUTATIONS.map((m) => m.rule));
    if (survivors.length > 0 || rules.size !== 8) {
      console.error(`  ✗ ${survivors.length} mutation(s) survived, ${rules.size} of 8 rules have one:\n      ${survivors.join('\n      ')}`);
      process.exit(1);
    }
    console.log(`  ✓ all ${MUTATIONS.length} died, and every rule R1 to R8 has at least one`);
  }
  console.log('\n✓ validate-dfr-weather: today only, OpenWeather only, never simulated, typed weather wins, credit travels with the reading.\n');
}

void main();
