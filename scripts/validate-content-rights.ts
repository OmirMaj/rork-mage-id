// validate-content-rights.ts — third-party content the app is not licensed to
// show stays hidden, and the content it IS licensed to show carries the credit
// its license asks for.
//
// WHY: MAGE ID's first App Store submission answers Apple's "do you have all
// necessary rights to third-party content?" (guidelines 5.2.1 / 5.2.2). The
// rights check (contentfix-specs/RIGHTS-VERDICT.md, 2026-10-02) found:
//   * Construction News — no publisher has given permission (ENR / Fine
//     Homebuilding forbid commercial copying; Construction Dive and
//     ConstructConnect allow personal use only). Founder: hide it for launch.
//   * Discover > Companies — Google business listings we may not store or show
//     without Google's logo. Founder: hide it.
//   * OpenWeather requires "Weather data provided by OpenWeather" on every
//     forecast; OpenStreetMap requires "© OpenStreetMap contributors" where its
//     geocoder named the place; neither appeared anywhere.
//   * wttr.in publishes no terms or data license and received the jobsite
//     address from the daily report.
//   * Baltimore County's open-data license requires its disclaimer verbatim;
//     Baltimore City's Real Property data is CC BY 3.0 (license link required).
// Every one of those is pinned here so a later edit cannot quietly undo it.
//
// Pure logic + node:fs source assertions — no react-native import (bun can't
// parse those). fileURLToPath + join because the repo path contains a space.
//
// Run: bun run scripts/validate-content-rights.ts
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

import { CONSTRUCTION_NEWS_ENABLED, COMPANIES_DIRECTORY_ENABLED, PRODUCT_PHOTOS_ENABLED } from '../constants/featureFlags';
import {
  FEATURE_REGISTRY, HIDDEN_FEATURE_IDS, isFeatureHidden, searchFeatures, getFeature,
} from '../utils/featureRegistry';
import {
  OPENWEATHER_CREDIT, OPENWEATHER_URL, OSM_CREDIT, OSM_COPYRIGHT_URL,
  BALTIMORE_COUNTY_DISCLAIMER, BALTIMORE_COUNTY_DISCLAIMER_TITLE, BALTIMORE_CITY_CC_BY_LINE, CC_BY_3_URL,
  showsOpenWeatherCredit, coverageShowsOpenWeatherCredit, mdRecordCredit,
} from '../utils/contentCredits';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, why = ''): void {
  if (cond) { passed++; return; }
  failed++;
  console.error(`  FAIL  ${name}${why ? `\n        ${why}` : ''}`);
}

/** Source with // line comments and JSX/block comments blanked, so a pin
 *  cannot be satisfied by a sentence in a comment. Strings are left alone. */
function code(src: string): string {
  return src
    .split('\n')
    .map((l) => (/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(l) ? '' : l))
    .join('\n');
}

// ── 1. The two flags ───────────────────────────────────────────────────────
ok('CONSTRUCTION_NEWS_ENABLED is false for launch', CONSTRUCTION_NEWS_ENABLED === false);
ok('COMPANIES_DIRECTORY_ENABLED is false for launch', COMPANIES_DIRECTORY_ENABLED === false);
const flagsSrc = read('constants/featureFlags.ts');
ok('each flag cites the rights verdict',
  (flagsSrc.match(/RIGHTS-VERDICT\.md/g) ?? []).length >= 2);

// ── 2. Feature search (⌘K / universal search) ──────────────────────────────
ok('construction-news is hidden while its flag is off', isFeatureHidden('construction-news') === !CONSTRUCTION_NEWS_ENABLED);
ok('companies is hidden while its flag is off', isFeatureHidden('companies') === !COMPANIES_DIRECTORY_ENABLED);
ok('nothing else is hidden', [...HIDDEN_FEATURE_IDS].every((id) => id === 'construction-news' || id === 'companies'));
ok('an undefined feature is never hidden', isFeatureHidden(undefined) === false);
ok('the rows stay in the registry, so the flag restores them exactly',
  !!getFeature('construction-news') && !!getFeature('companies'));
const hitIds = (q: string) => searchFeatures(q, 'enterprise', { persona: 'contractor', maxResults: 200 }).map((h) => h.entry.id);
for (const q of ['news', 'construction news', 'headlines', 'industry news', 'trade news']) {
  ok(`search '${q}' never offers Construction news`, !hitIds(q).includes('construction-news'));
}
for (const q of ['companies', 'compan', 'firms', 'gc directory']) {
  ok(`search '${q}' never offers Companies`, !hitIds(q).includes('companies'));
}
ok("search still works for everything else ('brief' → Morning brief)", hitIds('brief').includes('brief'));
ok('no visible registry row routes to either hidden screen',
  FEATURE_REGISTRY.filter((e) => !isFeatureHidden(e.id))
    .every((e) => e.route !== '/construction-news' && e.route !== '/(tabs)/discover/companies'));

// ── 3. Entry points (static) ───────────────────────────────────────────────
const discover = code(read('app/(tabs)/discover/index.tsx'));
ok('Discover: imports COMPANIES_DIRECTORY_ENABLED from constants/featureFlags',
  /import \{[^}]*\bCOMPANIES_DIRECTORY_ENABLED\b[^}]*\} from '@\/constants\/featureFlags'/.test(discover));
ok('Discover: the Companies pill is filtered out while the flag is off',
  /\(COMPANIES_DIRECTORY_ENABLED \|\| tab\.id !== 'companies'\)/.test(discover));
ok('Discover: the pill router has no companies route while the flag is off',
  /\.\.\.\(COMPANIES_DIRECTORY_ENABLED \? \{ companies: '\/\(tabs\)\/discover\/companies' \} : \{\}\)/.test(discover));
ok('Discover: the Companies card renders only behind the flag',
  /\{COMPANIES_DIRECTORY_ENABLED && \(\s*<NavigationCard[\s\S]{0,200}title="Companies"/.test(discover));
{
  // Every literal route to the companies screen must sit behind the flag.
  const idx = [...discover.matchAll(/\/\(tabs\)\/discover\/companies/g)].map((m) => m.index ?? 0);
  ok('Discover: every companies route literal is behind COMPANIES_DIRECTORY_ENABLED',
    idx.length > 0 && idx.every((i) => discover.slice(Math.max(0, i - 400), i).includes('COMPANIES_DIRECTORY_ENABLED')),
    `${idx.length} literal(s); one is not within 400 chars after the flag`);
  ok('Discover: no hint line promises company listings while the flag is off',
    /COMPANIES_DIRECTORY_ENABLED\s*\?\s*'Tools · bids · companies · AI · marketplace'\s*:\s*'Tools · bids · AI · marketplace'/.test(discover)
    && /COMPANIES_DIRECTORY_ENABLED\s*\?\s*'Government contracts, private bids and company listings'\s*:\s*'Government contracts and private bids'/.test(discover));
}
const tools = code(read('app/(tabs)/discover/tools.tsx'));
ok('Tools: rows whose feature is hidden are filtered out',
  /TOOL_ROWS\.filter\(r => r\.section === section && \(hasProjects \|\| !r\.needsProjects\) && !isFeatureHidden\(r\.feature\)\)/.test(tools));
ok('Tools: empty sections are dropped (INDUSTRY disappears with its only tile)', /\.filter\(g => g\.rows\.length > 0\)/.test(tools));
ok("Tools: the news tile no longer promises ENR / Construction Dive / NAHB", !/ENR, Construction Dive, NAHB/.test(tools));
const sidebar = code(read('components/DesktopSidebar.tsx'));
ok('Sidebar: rows whose feature is hidden are filtered out',
  /\.filter\(item => !isFeatureHidden\(item\.feature\)\)/.test(sidebar));
const registry = code(read('utils/featureRegistry.ts'));
ok('Registry: searchFeatures skips hidden rows', /for \(const entry of FEATURE_REGISTRY\) \{\s*if \(isFeatureHidden\(entry\.id\)\) continue;/.test(registry));

const companies = code(read('app/(tabs)/discover/companies.tsx'));
ok('Companies route: redirects to Discover while the flag is off',
  /export default function CompaniesRoute\(\) \{\s*if \(!COMPANIES_DIRECTORY_ENABLED\) return <Redirect href="\/\(tabs\)\/discover" \/>;\s*return <CachedCompaniesScreen \/>;\s*\}/.test(companies));
ok('Companies route: the screen itself is kept (not exported as default)', /\nfunction CachedCompaniesScreen\(\)/.test(companies) && !/export default function CachedCompaniesScreen/.test(companies));
const news = code(read('app/construction-news.tsx'));
ok('News route: redirects to Discover while the flag is off',
  /export default function ConstructionNewsRoute\(\) \{\s*if \(!CONSTRUCTION_NEWS_ENABLED\) return <Redirect href="\/\(tabs\)\/discover" \/>;\s*return <ConstructionNewsScreen \/>;\s*\}/.test(news));
ok('News route: the screen itself is kept', /\nfunction ConstructionNewsScreen\(\)/.test(news));

// No new door: every file that names either route must be one of the known,
// gated (or inert) places. A new tile, card, deep link or tutorial step that
// opens either screen fails here until it is gated and added to this list.
const SCAN_DIRS = ['app', 'components', 'utils', 'hooks', 'contexts', 'constants', 'lib'];
function walk(dir: string, out: string[]): void {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return;
  for (const name of readdirSync(abs)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(abs, name);
    if (statSync(p).isDirectory()) walk(relative(ROOT, p), out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)) out.push(relative(ROOT, p));
  }
}
const files: string[] = [];
for (const d of SCAN_DIRS) walk(d, files);
const KNOWN_DOORS: Record<string, string> = {
  'app/(tabs)/discover/index.tsx': 'gated on COMPANIES_DIRECTORY_ENABLED (above)',
  'app/(tabs)/discover/tools.tsx': 'row filtered by isFeatureHidden (above)',
  'components/DesktopSidebar.tsx': 'row filtered by isFeatureHidden (above)',
  'utils/featureRegistry.ts': 'search skips hidden rows (above)',
  'app/_layout.tsx': 'Stack.Screen registration — the route redirects',
  'app/construction-news.tsx': 'the screen itself — redirects',
  'utils/routeTitle.ts': 'browser-tab title only',
  'utils/desktopPage.ts': 'desktop page width only',
  'hooks/useConstructionNews.ts': 'the edge-function name, used only by the screen',
  'utils/constructionNews.ts': "the screen's pure half",
};
const ROUTE_RE = /['"`]\/?construction-news['"`]|\/\(tabs\)\/discover\/companies|discover\/companies['"`]|mageid:\/\/(construction-news|companies)/;
for (const f of files) {
  const src = code(read(f));
  if (!ROUTE_RE.test(src)) continue;
  ok(`no unlisted door to a hidden screen: ${f}`, f in KNOWN_DOORS,
    'gate it on CONSTRUCTION_NEWS_ENABLED / COMPANIES_DIRECTORY_ENABLED (or isFeatureHidden) and list it in KNOWN_DOORS');
}

// ── 4. Credit lines — the pure rule ────────────────────────────────────────
ok('OpenWeather credit wording', OPENWEATHER_CREDIT === 'Weather data provided by OpenWeather');
ok('OpenWeather link', OPENWEATHER_URL === 'https://openweathermap.org/');
ok('OpenStreetMap credit wording', OSM_CREDIT === '© OpenStreetMap contributors');
ok('OpenStreetMap link', OSM_COPYRIGHT_URL === 'https://www.openstreetmap.org/copyright');
ok('a live day earns the OpenWeather credit', showsOpenWeatherCredit([{ source: 'live' }]) === true);
ok('a mixed window earns it', showsOpenWeatherCredit([{ source: 'simulated' }, { source: 'live' }]) === true);
ok('a fully simulated window does NOT (it is not their data)', showsOpenWeatherCredit([{ source: 'simulated' }, { source: 'simulated' }]) === false);
ok('an empty window does not', showsOpenWeatherCredit([]) === false);
ok('no window does not', showsOpenWeatherCredit(null) === false && showsOpenWeatherCredit(undefined) === false);
ok('coverage: live and mixed earn it', coverageShowsOpenWeatherCredit('live') && coverageShowsOpenWeatherCredit('mixed'));
ok('coverage: simulated and empty do not', !coverageShowsOpenWeatherCredit('simulated') && !coverageShowsOpenWeatherCredit('empty') && !coverageShowsOpenWeatherCredit(null));

// ── 5. Credit lines — every OpenWeather surface ────────────────────────────
const notice = code(read('components/schedule/SimulatedWeatherNotice.tsx'));
{
  const credit = notice.slice(notice.indexOf('export function WeatherCredit'), notice.indexOf('export interface SimulatedDayChipProps'));
  ok('WeatherCredit exists', credit.length > 0 && notice.includes('export function WeatherCredit'));
  ok('WeatherCredit renders nothing without a live day (simulated weather carries no credit)',
    /if \(!showsOpenWeatherCredit\(days\)\) return null;/.test(credit));
  ok('WeatherCredit shows the OpenWeather line, linked', /\{OPENWEATHER_CREDIT\}/.test(credit) && /openLink\(OPENWEATHER_URL\)/.test(credit));
  ok('WeatherCredit shows the OSM credit, linked, next to a place name', /place \?/.test(credit) && /\{OSM_CREDIT\}/.test(credit) && /openLink\(OSM_COPYRIGHT_URL\)/.test(credit));
  ok('WeatherCredit links are announced as links', (credit.match(/accessibilityRole="link"/g) ?? []).length >= 2);
  const placeLine = notice.slice(notice.indexOf('export function WeatherPlaceLine'), notice.indexOf('export function WeatherCredit'));
  ok('WeatherPlaceLine takes the displayed days (required)', /days: readonly SourcedDay\[\];/.test(notice.slice(notice.indexOf('export interface WeatherPlaceLineProps'), notice.indexOf('export function WeatherPlaceLine'))));
  ok('WeatherPlaceLine carries the credit (with the OSM line) under the place', /<WeatherCredit days=\{days\} place \/>/.test(placeLine));
  const banner = notice.slice(notice.indexOf('export function SimulatedWeatherBanner'), notice.indexOf('export interface WeatherPlaceLineProps'));
  ok('the SIMULATED banner never carries the credit', !/WeatherCredit|OPENWEATHER_CREDIT/.test(banner));
}
// Every <WeatherPlaceLine> passes the days it describes.
for (const f of files) {
  const src = code(read(f));
  const uses = src.match(/<WeatherPlaceLine\b[^>]*>/g) ?? [];
  for (const u of uses) ok(`${f}: <WeatherPlaceLine> passes days=`, /\bdays=\{/.test(u), u);
}
/** The surfaces that print OpenWeather numbers, and how each is credited. */
const SURFACES: { file: string; pin: RegExp; how: string }[] = [
  { file: 'components/schedule/TodayView.tsx', pin: /<WeatherPlaceLine text=\{weatherDesc\.placeLine\} days=\{forecast\} \/>/, how: 'place line + credit over the Today strip' },
  { file: 'components/schedule/LookaheadView.tsx', pin: /<WeatherPlaceLine text=\{weatherDesc\.placeLine\} days=\{displayedDays\} \/>/, how: 'place line + credit over the week strips' },
  { file: 'app/(tabs)/schedule/index.tsx', pin: /<WeatherPlaceLine text=\{ganttWeatherDesc\.placeLine \?\? ganttWeatherDesc\.cause\} days=\{ganttForecast\}/, how: 'place line + credit over both Gantts' },
  { file: 'app/(tabs)/schedule/index.tsx', pin: /<WeatherPlaceLine text=\{ganttWeatherDesc\.placeLine\} days=\{shownDays\} \/>/, how: 'task detail Weather impact panel' },
  { file: 'app/(tabs)/schedule/index.tsx', pin: /<WeatherCredit days=\{ganttForecast\} place \/>/, how: 'the weather-check banner' },
  { file: 'components/schedule/WeatherReschedulePrompt.tsx', pin: /<WeatherCredit days=\{conflicts\.map\(c => c\.hitDay\)\}/, how: 'banner + review sheet' },
  { file: 'components/schedule/WeatherRescheduleModal.tsx', pin: /<WeatherCredit days=\{creditDays\}/, how: 'reschedule preview' },
];
for (const s of SURFACES) ok(`${s.file}: ${s.how}`, s.pin.test(code(read(s.file))));
{
  const sched = code(read('app/(tabs)/schedule/index.tsx'));
  ok('schedule tab: both place lines (over both Gantts) carry the gantt forecast',
    (sched.match(/<WeatherPlaceLine text=\{ganttWeatherDesc\.placeLine \?\? ganttWeatherDesc\.cause\} days=\{ganttForecast\}/g) ?? []).length === 2);
  const prompt = code(read('components/schedule/WeatherReschedulePrompt.tsx'));
  ok('reschedule prompt: credited on the banner AND in the review sheet',
    (prompt.match(/<WeatherCredit days=\{conflicts\.map\(c => c\.hitDay\)\}/g) ?? []).length >= 2);
  const modal = code(read('components/schedule/WeatherRescheduleModal.tsx'));
  ok('reschedule modal: credit only for a live or mixed window',
    /const creditDays = coverageShowsOpenWeatherCredit\(forecastSource\) \? \[\{ source: 'live' as const \}\] : \[\];/.test(modal));
}
// GanttChart / VerticalGantt print forecast badges and are hosted ONLY by the
// schedule tab, directly under its credited place line (pinned above).
for (const g of ['GanttChart', 'VerticalGantt']) {
  const hosts = files.filter((f) => new RegExp(`<${g}\\b`).test(code(read(f))));
  ok(`${g} is hosted only under the credited place line (app/(tabs)/schedule/index.tsx)`,
    hosts.length > 0 && hosts.every((h) => h === 'app/(tabs)/schedule/index.tsx'), hosts.join(', '));
}
// Any other file that fetches a forecast must be one of the surfaces above.
const FORECAST_FETCHERS = new Set(['components/schedule/TodayView.tsx', 'components/schedule/LookaheadView.tsx', 'app/(tabs)/schedule/index.tsx', 'app/schedule-pro.tsx', 'utils/weatherService.ts']);
for (const f of files) {
  if (!/\bgetForecastWithFallback\(|\bgetOpenWeatherForecast\(/.test(code(read(f)))) continue;
  ok(`forecast fetched only by a credited surface: ${f}`, FORECAST_FETCHERS.has(f),
    'render <WeatherPlaceLine days=…> or <WeatherCredit days=…> where the forecast shows, then list it here');
}
{
  // schedule-pro shows its forecast only through the prompt and the modal.
  const pro = code(read('app/schedule-pro.tsx'));
  ok('schedule-pro shows its forecast only through the credited prompt/modal',
    !/getConditionIcon|\.tempHigh\b|<WeatherPlaceLine|<GanttChart|<VerticalGantt/.test(pro));
}

// ── 6. wttr.in is gone ─────────────────────────────────────────────────────
for (const f of files.filter((p) => /^(app|components|utils|hooks)\//.test(p))) {
  ok(`no wttr.in call: ${f}`, !/wttr\.in/i.test(code(read(f))));
}
const dfr = read('app/daily-report.tsx');
ok('daily report: no mention of wttr at all (call, comments, copy)', !/wttr/i.test(dfr));
ok('daily report: no auto-fetch of weather on open', !/fetchWeather\(\{ auto: true \}\)/.test(dfr) && !/const fetchWeather = useCallback/.test(dfr));
ok('daily report: the weather fields stay typed by hand', (dfr.match(/isManual: true \}\)\)/g) ?? []).length >= 3);
ok('daily report: no Auto-fetch button offers a fetch that does not exist (no dead button)', !/testID="dfr-weather-fetch"/.test(dfr) && !/'Auto-fetch'\)/.test(dfr));
ok('daily report: no fake weather value is seeded', /const EMPTY_DFR_WEATHER: DFRWeather = \{ temperature: '', conditions: '', wind: '', isManual: true \};/.test(dfr));

// ── 7. Baltimore records ───────────────────────────────────────────────────
ok('County disclaimer is the County text, verbatim (opening sentence)', BALTIMORE_COUNTY_DISCLAIMER.startsWith('This data is only for general information purposes only. This data may be inaccurate or contain errors or omissions.'));
ok('County disclaimer is complete (closing clause)', BALTIMORE_COUNTY_DISCLAIMER.endsWith('arising from or in connection with the use of or reliance upon this data.'));
ok('County disclaimer names merchantability and fitness', /merchantability and fitness for any particular purpose/.test(BALTIMORE_COUNTY_DISCLAIMER));
ok('County disclaimer title', BALTIMORE_COUNTY_DISCLAIMER_TITLE === 'Baltimore County data disclaimer');
ok('CC BY line + link', BALTIMORE_CITY_CC_BY_LINE === 'Real Property data: City of Baltimore, CC BY 3.0' && CC_BY_3_URL === 'https://creativecommons.org/licenses/by/3.0/');
{
  const c = mdRecordCredit('baltimore_county');
  ok('a County record carries the County disclaimer', c?.kind === 'county_disclaimer' && c.text === BALTIMORE_COUNTY_DISCLAIMER);
  const city = mdRecordCredit('baltimore_city');
  ok('a City record carries the CC BY 3.0 line', city?.kind === 'city_cc_by' && city.url === CC_BY_3_URL);
  ok('anything else carries neither', mdRecordCredit(null) === null && mdRecordCredit('nyc') === null);
}
const mdCard = code(read('components/buildingRecord/MdBuildingRecordCard.tsx'));
ok('MD card: reads the credit for the confirmed side', /const credit = mdRecordCredit\(md\.confirmed\?\.side\);/.test(mdCard));
ok('MD card: renders the County disclaimer text in the ready state', /credit\?\.kind === 'county_disclaimer'[\s\S]{0,700}\{credit\.text\}/.test(mdCard));
ok('MD card: renders the CC BY line as a link', /credit\?\.kind === 'city_cc_by'[\s\S]{0,700}openUrl\(credit\.url\)[\s\S]{0,400}\{credit\.text\}/.test(mdCard));

// ── 8. Selections product photos ───────────────────────────────────────────
// og-image answers imageUrl: null to every call (no retailer permission, no
// Pexels credit). The client must not keep a control that can only end in
// "No image found" — that blames the GC's link for something MAGE switched off.
ok('PRODUCT_PHOTOS_ENABLED is false for launch', PRODUCT_PHOTOS_ENABLED === false);
ok('PRODUCT_PHOTOS_ENABLED cites the rights verdict',
  /RIGHTS-VERDICT\.md[\s\S]{0,1200}export const PRODUCT_PHOTOS_ENABLED = false;/.test(flagsSrc));
{
  const og = code(read('supabase/functions/og-image/index.ts'));
  ok('og-image server flag is off (the client flag mirrors it)', /const AUTO_PRODUCT_PHOTOS_ENABLED = false;/.test(og));
  const sel = code(read('app/selections.tsx'));
  ok('selections: imports PRODUCT_PHOTOS_ENABLED from constants/featureFlags',
    /import \{[^}]*\bPRODUCT_PHOTOS_ENABLED\b[^}]*\} from '@\/constants\/featureFlags'/.test(sel));
  ok('selections: curation calls og-image only behind the flag',
    /imageUrl: PRODUCT_PHOTOS_ENABLED\s*\?\s*await resolveSelectionImage\(/.test(sel)
    && (sel.match(/resolveSelectionImage\(/g) ?? []).length === 2);
  ok('selections: the set-photo handler returns at once while the flag is off',
    /const onSetOptionPhoto = useCallback\(\(option: SelectionOption, category: string\) => \{\s*if \(!PRODUCT_PHOTOS_ENABLED\) return;/.test(sel));
  ok('selections: an option card wires no long-press while the flag is off (no dead control)',
    /onSetPhoto=\{PRODUCT_PHOTOS_ENABLED \? \(\) => onSetOptionPhoto\(o, category\.category\) : undefined\}/.test(sel)
    && (sel.match(/onSetPhoto=\{/g) ?? []).length === 1);
  ok('selections: no copy promises photos from regenerating', !/regenerate the options to refresh photos/i.test(sel));
  ok('selections: no Pexels claim left in the screen', !/pexels/i.test(read('app/selections.tsx')));
}

console.info(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
