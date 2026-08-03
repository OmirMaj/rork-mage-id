// validate-weather-provenance.ts — stops the app from presenting fabricated
// weather as a real forecast, and stops a dead feature flag from paying for
// network traffic.
//
// WHY (weather): components/schedule/LookaheadView.tsx called
// getSimulatedForecast() UNCONDITIONALLY — it never attempted the real API —
// and getSimulatedForecast ignores its `_region` argument entirely, so the
// "forecast" had no relation to the jobsite. Nothing in the UI said it was
// invented. Meanwhile weather-driven reschedules write entries into
// ProjectSchedule.weatherDelayLog, the record a GC hands an owner to justify a
// delay. Fiction was being logged as delay documentation.
//
// WHY (hire): contexts/HireContext.tsx exports HIRE_ENABLED = false and eight
// consumers read it to hide entry points — but the provider never read its own
// flag, so every launch still ran four react-query fetches and opened a
// Supabase Realtime channel for a subsystem no user can reach.
//
// Pure logic + node:fs source assertions — no react-native import (bun can't
// parse those). fileURLToPath + join because the repo path contains a space.
//
// Run: bun run scripts/validate-weather-provenance.ts
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

import { getSimulatedForecast, type DayForecast } from '../utils/weatherService';
import { computeWeatherReschedule, buildWeatherDelayLog } from '../utils/weatherReschedule';
import {
  summarizeForecastSource,
  hasSimulatedDays,
  countSimulatedDays,
  partitionDatesBySource,
  WEATHER_API_KEY_ENV,
  SIMULATED_WEATHER_HEADLINE,
} from '../utils/weatherProvenance';
import { hireQueriesEnabled, hireCanSync, hireRealtimeEnabled } from '../utils/hireGating';
import type { ScheduleTask } from '../types';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}

// Build a forecast day by hand so the tests state provenance explicitly.
function day(date: string, source: DayForecast['source'], workable: boolean): DayForecast {
  return {
    date,
    condition: workable ? 'clear' : 'storm',
    tempHigh: 60, tempLow: 45, precipChance: workable ? 5 : 90,
    windSpeed: 8, isWorkable: workable, icon: 'x', source,
  };
}

function task(over: Partial<ScheduleTask> & { id: string }): ScheduleTask {
  // Defaults first, `over` last — so every field (including id) comes from the
  // caller when supplied.
  return {
    title: over.id, phase: 'Sitework',
    startDay: 1, durationDays: 1,
    progress: 0, status: 'not_started',
    ...over,
  } as ScheduleTask;
}

/** Mirrors weatherReschedule's isoForDay so fixtures line up in ANY timezone.
 *  (Hardcoding dates across a DST boundary silently desynced the first cut of
 *  this file — local setDate() + UTC toISOString() shift by a day.) */
function isoForDay(startDate: Date, dayNumber: number): string {
  const d = new Date(startDate.getTime());
  d.setDate(d.getDate() + (dayNumber - 1));
  return d.toISOString().split('T')[0];
}

/** Strip comments so "we used to call getSimulatedForecast()" in a code
 *  comment can't satisfy — or violate — a source assertion. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Source with `import ... from '...';` statements removed. Without this, an
 *  assertion like "renders SIMULATED_WEATHER_HEADLINE" is satisfied by a file
 *  that merely IMPORTS the constant and then shows different copy — which is
 *  exactly the mutation that first slipped past this validator. */
function stripImports(src: string): string {
  return src.replace(/^import[\s\S]*?from\s+'[^']*';$/gm, '');
}

/** Every .ts/.tsx under the given repo-relative dirs, as repo-relative paths.
 *  Used by the sweep in section 6 so a NEW screen that renders weather is
 *  caught automatically, without anyone remembering to add it to a list. */
function collectSourceFiles(dirs: readonly string[]): string[] {
  const out: string[] = [];
  const walk = (abs: string) => {
    let entries: string[];
    try { entries = readdirSync(abs); } catch { return; }
    for (const name of entries) {
      if (name === 'node_modules' || name.startsWith('.')) continue;
      const full = join(abs, name);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) walk(full);
      else if (name.endsWith('.tsx') || name.endsWith('.ts')) out.push(relative(ROOT, full));
    }
  };
  for (const d of dirs) walk(join(ROOT, d));
  return out.sort();
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. Every forecast day is tagged with its provenance
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[1] Forecasts carry provenance');

const sim = getSimulatedForecast(new Date('2026-03-02T12:00:00Z'), 7);
ok('getSimulatedForecast tags every day source=simulated',
  sim.length === 7 && sim.every((d) => d.source === 'simulated'),
  `got: ${[...new Set(sim.map((d) => d.source))].join(',')}`);

ok('a live day is distinguishable from a simulated one',
  day('2026-03-02', 'live', true).source !== day('2026-03-02', 'simulated', true).source);

// condenseToDaily is the only place a 'live' DayForecast is constructed —
// pin it at the source so a future edit can't quietly drop the tag.
const serviceSrc = read('utils/weatherService.ts');
ok('weatherService stamps source on the OpenWeather path',
  /source:\s*'live'/.test(serviceSrc));
ok('weatherService stamps source on the simulated path',
  /source:\s*'simulated'/.test(serviceSrc));
ok('DayForecast.source is required (not optional)',
  /\n\s*source:\s*ForecastSource;/.test(serviceSrc),
  'a `source?:` would let an untagged forecast travel through the app');

// ═══════════════════════════════════════════════════════════════════════════
// 2. Coverage rollups
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[2] Coverage summary');

const allLive = [day('2026-03-02', 'live', true), day('2026-03-03', 'live', true)];
const allSim = [day('2026-03-02', 'simulated', true), day('2026-03-03', 'simulated', true)];
const mixed = [day('2026-03-02', 'live', true), day('2026-03-03', 'simulated', true)];

ok('all live → live', summarizeForecastSource(allLive) === 'live');
ok('all simulated → simulated', summarizeForecastSource(allSim) === 'simulated');
ok('padded tail → mixed', summarizeForecastSource(mixed) === 'mixed');
ok('empty → empty', summarizeForecastSource([]) === 'empty');

ok('hasSimulatedDays false for a fully live window', !hasSimulatedDays(allLive));
ok('hasSimulatedDays true for a mixed window', hasSimulatedDays(mixed));
ok('hasSimulatedDays true for a fully simulated window', hasSimulatedDays(allSim));
ok('hasSimulatedDays false for an empty window', !hasSimulatedDays([]),
  'nothing displayed → nothing to disclaim');
ok('countSimulatedDays counts only the invented ones', countSimulatedDays(mixed) === 1);

// Unknown provenance is never promoted to evidence.
const part = partitionDatesBySource(['2026-03-02', '2026-03-03', '2026-03-09'], mixed);
ok('partitionDatesBySource keeps live dates live',
  part.live.length === 1 && part.live[0] === '2026-03-02');
ok('partitionDatesBySource treats an unmatched date as simulated',
  part.simulated.includes('2026-03-09'),
  'a date with no forecast day behind it must never count as evidence');

// ═══════════════════════════════════════════════════════════════════════════
// 3. Provenance survives the reschedule math
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[3] computeWeatherReschedule carries provenance through');

const start = new Date('2026-06-01T12:00:00Z');
// Day 1 → a real storm reading. Day 8 → a storm from the simulated tail
// (OpenWeather's free tier only reaches 5 days; the rest is padded).
const LIVE_HIT = isoForDay(start, 1);
const SIM_HIT = isoForDay(start, 8);
const window: DayForecast[] = [
  day(LIVE_HIT, 'live', false),
  day(isoForDay(start, 2), 'live', true),
  day(SIM_HIT, 'simulated', false),
];
const tasks: ScheduleTask[] = [
  task({ id: 'a', startDay: 1, durationDays: 1, isWeatherSensitive: true }),
  task({ id: 'b', startDay: 8, durationDays: 1, isWeatherSensitive: true }),
  task({ id: 'c', startDay: 12, durationDays: 2, dependencies: ['b'] }),
];
const r = computeWeatherReschedule(tasks, start, window);

ok('affectedDates includes both the live and the simulated hit',
  r.affectedDates.includes(LIVE_HIT) && r.affectedDates.includes(SIM_HIT),
  `got ${JSON.stringify(r.affectedDates)}`);
ok('liveAffectedDates holds only the real reading',
  r.liveAffectedDates.length === 1 && r.liveAffectedDates[0] === LIVE_HIT,
  `got ${JSON.stringify(r.liveAffectedDates)}`);
ok('simulatedAffectedDates holds only the invented one',
  r.simulatedAffectedDates.length === 1 && r.simulatedAffectedDates[0] === SIM_HIT,
  `got ${JSON.stringify(r.simulatedAffectedDates)}`);
ok('forecastSource reports the window as mixed', r.forecastSource === 'mixed');
ok('live + simulated partition exactly the affected dates',
  r.liveAffectedDates.length + r.simulatedAffectedDates.length === r.affectedDates.length);

const allSimResult = computeWeatherReschedule(
  [task({ id: 'a', startDay: 1, durationDays: 1, isWeatherSensitive: true })],
  start,
  [day(LIVE_HIT, 'simulated', false)],
);
ok('a fully simulated window reports forecastSource=simulated',
  allSimResult.forecastSource === 'simulated');
ok('a fully simulated window has zero live affected dates',
  allSimResult.liveAffectedDates.length === 0 && allSimResult.impacts.length > 0,
  'the impact is real as a plan; the evidence is not');

// ═══════════════════════════════════════════════════════════════════════════
// 4. Simulated data cannot reach a delay-log entry
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[4] weatherDelayLog admits no fiction');

const idGen = () => 'wd-test';
const at = '2026-03-02T12:00:00.000Z';

const blocked = buildWeatherDelayLog(allSimResult, idGen, at);
ok('a wholly-simulated reschedule produces NO log entry', blocked === null,
  'a delay record sourced from fiction is worse than no record');

const mixedEntry = buildWeatherDelayLog(r, idGen, at);
ok('a partly-live reschedule still produces an entry', mixedEntry !== null);
if (mixedEntry) {
  ok('mixed entry is stamped source=mixed', mixedEntry.source === 'mixed');
  ok('mixed entry `dates` excludes every simulated date',
    !mixedEntry.dates.includes(SIM_HIT) && mixedEntry.dates.includes(LIVE_HIT),
    `got ${JSON.stringify(mixedEntry.dates)}`);
  ok('mixed entry quarantines the simulated dates',
    (mixedEntry.simulatedDates ?? []).includes(SIM_HIT));
  ok('mixed entry carries a note explaining the exclusion',
    typeof mixedEntry.note === 'string' && /SIMULATED/.test(mixedEntry.note ?? ''));
}

const liveOnly = computeWeatherReschedule(
  [task({ id: 'a', startDay: 1, durationDays: 1, isWeatherSensitive: true })],
  start,
  [day(LIVE_HIT, 'live', false)],
);
const liveEntry = buildWeatherDelayLog(liveOnly, idGen, at);
ok('a fully live reschedule produces an entry', liveEntry !== null);
if (liveEntry) {
  ok('live entry is stamped source=live', liveEntry.source === 'live');
  ok('live entry carries no simulatedDates', liveEntry.simulatedDates === undefined);
  ok('live entry dates are the live dates', liveEntry.dates.join() === LIVE_HIT);
}

ok('no impacts → no entry (unchanged behaviour)',
  buildWeatherDelayLog(
    computeWeatherReschedule([task({ id: 'a', startDay: 1, durationDays: 1 })], start, window),
    idGen, at,
  ) === null);

// Every entry that exists is stamped — the type must not allow otherwise.
const typesSrc = read('types/index.ts');
ok('WeatherDelayLogEntry.source is a required field',
  /\n\s*source:\s*'live'\s*\|\s*'mixed';/.test(typesSrc),
  "an optional source would let an unstamped entry be read as evidence");
ok("WeatherDelayLogEntry has no 'simulated' source member",
  !/source:\s*'live'\s*\|\s*'mixed'\s*\|\s*'simulated'/.test(typesSrc),
  'a wholly-simulated delay is not logged at all, so the member must not exist');

// ═══════════════════════════════════════════════════════════════════════════
// 5. ONE marker component, owned in one place
// ═══════════════════════════════════════════════════════════════════════════
// The banner + per-day chip started life inline in LookaheadView. Four more
// surfaces needed the same treatment, so they were lifted into
// SimulatedWeatherNotice — the ONLY visual language for invented weather.
// These assertions pin the treatment itself; section 6 pins its use.
console.log('\n[5] SimulatedWeatherNotice — the single marker treatment');

const NOTICE_PATH = 'components/schedule/SimulatedWeatherNotice.tsx';
const notice = read(NOTICE_PATH);
const noticeCode = stripComments(notice);
// Import-stripped, so "the constant is imported" can never stand in for
// "the constant is rendered".
const noticeBody = stripImports(noticeCode);

ok('the shared marker exports a banner and a per-day chip',
  /export function SimulatedWeatherBanner\b/.test(noticeCode) &&
  /export function SimulatedDayChip\b/.test(noticeCode));
ok('the banner RENDERS the unmissable headline + body copy',
  /\{SIMULATED_WEATHER_HEADLINE\}/.test(noticeBody) && /SIMULATED_WEATHER_BODY/.test(noticeBody),
  'importing the copy is not the same as showing it');
ok('the chip RENDERS the per-day label',
  /\{SIMULATED_DAY_LABEL\}/.test(noticeBody));
ok('the banner is gated on the days it is handed, not on config',
  /hasSimulatedDays\(days\)/.test(noticeCode),
  'provenance is data on every DayForecast — no feature flag decides this');
ok('the banner renders nothing for a fully live window',
  /if \(!hasSimulatedDays\(days\)\) return null;/.test(noticeCode),
  'safe to mount unconditionally, so no surface can forget it');
ok('the chip renders nothing for a live day',
  /if \(source === 'live'\) return null;/.test(noticeCode));
ok('the marker is inline UI, not a tooltip/title attribute',
  /accessibilityRole="alert"/.test(noticeCode) && !/title=\{SIMULATED/.test(noticeCode));
ok('the marker uses the amber warning palette, never info/neutral',
  /Colors\.warningLight/.test(noticeCode) &&
  /Colors\.warning\b/.test(noticeCode) &&
  /Colors\.warningDark/.test(noticeCode) &&
  !/Colors\.info/.test(noticeCode),
  'this is a trust warning, not a hint');
ok('the marker uses palette tokens, not a fresh hex',
  !/#[0-9A-Fa-f]{6}/.test(noticeCode));
ok('the marker uses the CloudOff lucide icon (no emoji)',
  /CloudOff/.test(noticeCode) && /lucide-react-native/.test(noticeCode));
ok('the marker headline is unmissable copy',
  SIMULATED_WEATHER_HEADLINE === 'SIMULATED WEATHER — NOT A FORECAST',
  `got "${SIMULATED_WEATHER_HEADLINE}"`);
ok('the marker does not import weatherService (no cycle, structural props)',
  !/weatherService/.test(noticeCode));

// ═══════════════════════════════════════════════════════════════════════════
// 6. NO surface renders a forecast without a provenance marker in scope
// ═══════════════════════════════════════════════════════════════════════════
// The five sites below all used to call getSimulatedForecast() and print the
// result unlabelled. Each is now either routed to the real fetch path, or fed
// from a surface that is — and every one of them marks what it shows.
console.log('\n[6] Every weather surface marks what it shows');

/** A file "has a marker in scope" if it MOUNTS the shared component, or (for
 *  the two reschedule surfaces, which predate the extraction) renders the
 *  headline copy directly. Imports are stripped first: importing the marker
 *  and never rendering it must not count. */
function hasMarkerInScope(src: string): boolean {
  const body = stripImports(src);
  return /<SimulatedWeatherBanner\b/.test(body)
    || /<SimulatedDayChip\b/.test(body)
    || /SIMULATED_WEATHER_HEADLINE/.test(body);
}

// ── LookaheadView (already routed; now uses the shared marker) ──────────────
const lookahead = read('components/schedule/LookaheadView.tsx');
const lookaheadCode = stripComments(lookahead);

ok('LookaheadView no longer imports or calls getSimulatedForecast',
  !/\bgetSimulatedForecast\b/.test(lookaheadCode),
  'going straight to the simulator means the real API is never attempted');
ok('LookaheadView imports getForecastWithFallback',
  /getForecastWithFallback/.test(lookahead),
  'the same entry point the rest of the app uses (live → cached → simulated)');
ok('LookaheadView calls getForecastWithFallback',
  /getForecastWithFallback\s*\(/.test(lookahead));
ok('LookaheadView takes the project location',
  /location\?:\s*string/.test(lookahead) && /city:\s*location/.test(lookahead),
  'live data must be for the jobsite, not a default region');
ok('LookaheadView renders the shared banner',
  /<SimulatedWeatherBanner\b/.test(lookaheadCode));
ok('the banner is gated on displayed days, not on the raw fetch',
  /<SimulatedWeatherBanner\s+days=\{displayedDays\}/.test(lookaheadCode),
  'the requirement is "when any DISPLAYED day is not live"');
ok('LookaheadView renders a per-day chip driven by each day\'s source',
  /<SimulatedDayChip\s+source=\{f\.source\}/.test(lookaheadCode));

// ── TodayView — the 6am screen. Was the worst offender. ────────────────────
const todayView = read('components/schedule/TodayView.tsx');
const todayViewCode = stripComments(todayView);

ok('TodayView no longer imports or calls getSimulatedForecast',
  !/\bgetSimulatedForecast\b/.test(todayViewCode),
  "a superintendent decides whether to pour off this screen");
ok('TodayView goes through getForecastWithFallback',
  /getForecastWithFallback\s*\(/.test(todayViewCode));
ok('TodayView takes the jobsite location (string + geocode)',
  /location\?:\s*string/.test(todayView) &&
  /locationLatitude\?:\s*number/.test(todayView) &&
  /locationLongitude\?:\s*number/.test(todayView));
ok('TodayView passes the location through to the fetch',
  /city:\s*location\?\.trim\(\)/.test(todayViewCode) &&
  /latitude:\s*locationLatitude/.test(todayViewCode) &&
  /longitude:\s*locationLongitude/.test(todayViewCode));
ok('TodayView starts with an EMPTY forecast, not a simulated seed',
  /useState<DayForecast\[\]>\(\[\]\)/.test(todayViewCode),
  'one frame with no weather is honest; a frame of invented weather is not');
ok('TodayView marks the whole strip and each day',
  /<SimulatedWeatherBanner\s+days=\{forecast\}/.test(todayViewCode) &&
  /<SimulatedDayChip\s+source=\{f\.source\}/.test(todayViewCode));
ok("TodayView marks today's own reading, not just the outlook strip",
  /<SimulatedDayChip\s+source=\{todayWeather\.source\}/.test(todayViewCode),
  'the number acted on at 6am is the one that most needs a source');

// ── VerticalGantt — now fed by the parent's real forecast ──────────────────
const vGantt = read('components/schedule/VerticalGantt.tsx');
const vGanttCode = stripComments(vGantt);

ok('VerticalGantt no longer imports or calls getSimulatedForecast',
  !/\bgetSimulatedForecast\b/.test(vGanttCode));
ok('VerticalGantt takes the forecast as a prop',
  /forecast\?:\s*DayForecast\[\]/.test(vGantt),
  'same array the horizontal chart gets, from getForecastWithFallback');
ok('VerticalGantt renders NO weather when given none',
  /forecast \?\? \[\]/.test(vGanttCode),
  'a blank date column is honest; a fabricated one is not');
ok('VerticalGantt marks the column and each day row',
  /<SimulatedWeatherBanner\b/.test(vGanttCode) && /<SimulatedDayChip\b/.test(vGanttCode));
ok('VerticalGantt disclaims only the rows it actually renders',
  /displayedWeatherDays/.test(vGanttCode));

// ── GanttChart — a weather badge is a claim about a specific date ──────────
const gantt = read('components/schedule/GanttChart.tsx');
const ganttCode = stripComments(gantt);

ok('GanttChart never fabricates a forecast',
  !/\bgetSimulatedForecast\b/.test(ganttCode));
ok('GanttChart marks the badges it draws',
  /<SimulatedWeatherBanner\b/.test(ganttCode));
ok('GanttChart disclaims exactly the days behind rendered badges',
  /displayedRiskDays/.test(ganttCode),
  'forecast days that produce no badge are not displayed, so not disclaimed');

// ── app/(tabs)/schedule/index.tsx — the Gantt seed + task-detail panel ─────
const schedIndex = read('app/(tabs)/schedule/index.tsx');
const schedIndexCode = stripComments(schedIndex);

ok('the schedule screen no longer imports or calls getSimulatedForecast',
  !/\bgetSimulatedForecast\b/.test(schedIndexCode),
  'it did so three times: two Gantt seeds and the task-detail weather panel');
ok('the Gantt forecast starts EMPTY rather than seeded with simulated data',
  /useState<DayForecast\[\]>\(\[\]\)/.test(schedIndexCode) &&
  !/useState<DayForecast\[\]>\(\(\) =>/.test(schedIndexCode),
  'the old seed painted invented badges on first frame, then swapped silently');
ok('the Gantt forecast comes from getForecastWithFallback',
  /getForecastWithFallback\s*\(/.test(schedIndexCode));
ok('the Gantt forecast uses the project location AND geocode',
  /city:\s*selectedProject\?\.location\?\.trim\(\)/.test(schedIndexCode) &&
  /latitude:\s*selectedProject\?\.locationLatitude/.test(schedIndexCode) &&
  /longitude:\s*selectedProject\?\.locationLongitude/.test(schedIndexCode),
  'lat/lng beats a free-text address on rural sites');
ok('the task-detail weather panel reuses the real forecast',
  /const weatherForecast = ganttForecast;/.test(schedIndexCode),
  'it used to mint getSimulatedForecast(new Date(), 14) on every render');
ok('the task-detail weather panel marks what it prints',
  /<SimulatedWeatherBanner\s+days=\{shownDays\}/.test(schedIndexCode) &&
  /<SimulatedDayChip\s+source=\{f\.source\}/.test(schedIndexCode));
ok('both VerticalGantt mounts are fed the real forecast',
  (schedIndexCode.match(/forecast=\{ganttForecast\}/g) ?? []).length === 4,
  'two GanttChart mounts + two VerticalGantt mounts (mobile + desktop)');
ok('both TodayView mounts are fed the jobsite location',
  (schedIndexCode.match(/location=\{selectedProject\?\.location\}/g) ?? []).length === 4 &&
  (schedIndexCode.match(/locationLatitude=\{selectedProject\?\.locationLatitude\}/g) ?? []).length === 2,
  'two TodayView + two LookaheadView mounts take `location`; TodayView also takes lat/lng');

// ── The sweep: nothing NEW may render weather unmarked ─────────────────────
// Two independent nets, so a future surface can't slip through by copying
// either half of the old pattern.
const RENDERS_FORECAST = /getConditionIcon\s*\(/;      // turns a DayForecast into pixels
const IMPORTS_SIMULATOR = /\bgetSimulatedForecast\b/;  // mints one locally

const uiFiles = collectSourceFiles(['app', 'components']);

const unmarkedRenderers = uiFiles.filter((rel) => {
  const src = stripComments(read(rel));
  return RENDERS_FORECAST.test(src) && !hasMarkerInScope(src);
});
ok('no UI file renders a forecast without a provenance marker in scope',
  unmarkedRenderers.length === 0,
  unmarkedRenderers.join(', '));

const simulatorUsers = uiFiles.filter((rel) => IMPORTS_SIMULATOR.test(stripComments(read(rel))));
ok('no UI file calls getSimulatedForecast at all',
  simulatorUsers.length === 0,
  `getForecastWithFallback is the entry point for every screen — found: ${simulatorUsers.join(', ')}`);
const unmarkedSimulatorUsers = simulatorUsers.filter((rel) => !hasMarkerInScope(stripComments(read(rel))));
ok('and if one ever comes back, it must ship a marker with it',
  unmarkedSimulatorUsers.length === 0,
  unmarkedSimulatorUsers.join(', '));

ok('every one of the five original offenders is covered',
  ([
    'app/(tabs)/schedule/index.tsx',
    'components/schedule/VerticalGantt.tsx',
    'components/schedule/TodayView.tsx',
  ] as const).every((rel) => {
    const src = stripComments(read(rel));
    return !IMPORTS_SIMULATOR.test(src) && hasMarkerInScope(src);
  }),
  'schedule/index.tsx x3, VerticalGantt x1, TodayView x1');

// ── The two reschedule surfaces (unchanged, still asserted) ────────────────
// The screen that actually applies a reschedule must disclose provenance too —
// otherwise the blocked delay-log entry is a silent no-op.
const modal = read('components/schedule/WeatherRescheduleModal.tsx');
ok('WeatherRescheduleModal discloses a simulated forecast',
  /forecastSource/.test(modal) && /SIMULATED_WEATHER_HEADLINE/.test(modal));
ok('WeatherRescheduleModal explains that nothing will be logged',
  /SIMULATED_NO_LOG_NOTICE/.test(modal));

const prompt = read('components/schedule/WeatherReschedulePrompt.tsx');
ok('WeatherReschedulePrompt marks a simulated conflict',
  /hasSimulatedDays\(/.test(prompt) && /SIMULATED_WEATHER_HEADLINE/.test(prompt),
  '"N tasks hit bad weather" is a claim about reality');

// schedule-pro.tsx is the ONLY writer of weatherDelayLog. If it stays on the
// simulator the log can never fill even with a key set — the feature would be
// dead by construction.
const pro = stripComments(read('app/schedule-pro.tsx'));
ok('the delay-log writer no longer calls getSimulatedForecast',
  !/\bgetSimulatedForecast\b/.test(pro));
ok('the delay-log writer goes through getForecastWithFallback',
  /getForecastWithFallback\s*\(/.test(pro));
ok('the delay-log writer uses the project location / geocode',
  /latitude:\s*project\?\.locationLatitude/.test(pro),
  'lat/lng beats a free-text address on rural sites');

// ═══════════════════════════════════════════════════════════════════════════
// 7. The env var is documented where a developer will see it
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[7] EXPO_PUBLIC_OPENWEATHER_API_KEY is documented');

ok('weatherService header names the env var',
  serviceSrc.slice(0, 2000).includes(WEATHER_API_KEY_ENV),
  'must be in the file header, not buried at the call site');
ok('weatherService header says how to obtain and install a key',
  /openweathermap\.org/.test(serviceSrc) && /\.env/.test(serviceSrc));
ok('CLAUDE.md documents the env var',
  read('CLAUDE.md').includes(WEATHER_API_KEY_ENV),
  'the repo-level doc a developer actually reads');

// ═══════════════════════════════════════════════════════════════════════════
// 8. HireContext is inert while HIRE_ENABLED is false
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[8] HireContext issues no query and opens no Realtime channel');

ok('queries are disabled when the flag is off', hireQueriesEnabled(false) === false);
ok('queries are enabled when the flag is on', hireQueriesEnabled(true) === true);

ok('no Supabase sync when the flag is off, even with a user + config',
  hireCanSync(false, true, true) === false);
ok('sync returns when the flag is on and prerequisites are met',
  hireCanSync(true, true, true) === true);
ok('the flag does not override the other prerequisites',
  hireCanSync(true, false, true) === false && hireCanSync(true, true, false) === false);

ok('no Realtime channel when the flag is off',
  hireRealtimeEnabled(false, true, 5) === false);
ok('no Realtime channel with zero conversations (unchanged behaviour)',
  hireRealtimeEnabled(true, true, 0) === false);
ok('Realtime opens when the flag is on and there are conversations',
  hireRealtimeEnabled(true, true, 3) === true);

const hireSrc = read('contexts/HireContext.tsx');
const queryBlocks = hireSrc.match(/useQuery\(\{/g) ?? [];
const enabledFlags = hireSrc.match(/^\s*enabled:\s*QUERIES_ENABLED,$/gm) ?? [];
ok('every useQuery in HireContext carries `enabled`',
  queryBlocks.length > 0 && enabledFlags.length === queryBlocks.length,
  `${queryBlocks.length} useQuery vs ${enabledFlags.length} enabled:`);
ok('the four Hire queries are all gated', queryBlocks.length === 4,
  `expected jobs/workers/conversations/messages, found ${queryBlocks.length}`);
ok('`enabled` derives from the flag, not a literal',
  /const QUERIES_ENABLED = hireQueriesEnabled\(HIRE_ENABLED\)/.test(hireSrc));

ok('canSync is flag-gated',
  /hireCanSync\(HIRE_ENABLED,/.test(hireSrc),
  'the Supabase reads inside each queryFn and every write branch hang off canSync');
ok('the Realtime effect returns before supabase.channel()',
  hireSrc.indexOf('hireRealtimeEnabled(HIRE_ENABLED') > 0 &&
  hireSrc.indexOf('hireRealtimeEnabled(HIRE_ENABLED') < hireSrc.indexOf('supabase\n      .channel('),
  'the guard must precede the channel construction');

ok('the flag is gated, not deleted — the Realtime subscription still exists',
  /realtime-messages-\$\{userId\}/.test(hireSrc),
  'flipping HIRE_ENABLED back to true must restore everything with no further edits');
ok('the queryFns still contain their Supabase reads',
  /from\('job_listings'\)/.test(hireSrc) && /from\('conversations'\)/.test(hireSrc));

ok('mutations fail loudly rather than pretending to succeed',
  /requireEnabled\('addJob'\)/.test(hireSrc) &&
  /requireEnabled\('sendMessage'\)/.test(hireSrc) &&
  /requireEnabled\('startConversation'\)/.test(hireSrc) &&
  /hireDisabledError/.test(hireSrc));
ok('reads do NOT throw',
  !/getConversationMessages[\s\S]{0,200}requireEnabled/.test(hireSrc),
  'app/messages.tsx calls getConversationMessages during render, before its own flag guard');
ok('hook order is stable — no early return from the context hook',
  !/createContextHook\(\(\) => \{[\s\S]{0,400}if \(!HIRE_ENABLED\) return/.test(hireSrc),
  'react-query `enabled` is used instead, so hook count never changes');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
