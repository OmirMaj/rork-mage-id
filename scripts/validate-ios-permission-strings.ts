/**
 * validate-ios-permission-strings.ts — the iOS binary carries only the
 * permission strings the app actually uses, each one specific to MAGE ID.
 *
 * Run: bun run scripts/validate-ios-permission-strings.ts [--app <path>] [--src <dir>] [--layout <path>]
 *        [--privacy <path>] [--metadata <path>] [--introspect]
 *
 * WHY (lane APPNATIVE, build 18 — MAGE ID's first App Store submission).
 * expo-location is in package.json, and when app.json does not list its config
 * plugin, prebuild still adds it with its DEFAULTS: NSLocationAlwaysUsageDescription
 * and NSLocationAlwaysAndWhenInUseUsageDescription, both the generic
 * "Allow $(PRODUCT_NAME) to access your location". The app never asks for
 * background ("Always") location, so App Review sees an "Always" purpose
 * string with nothing behind it, and a generic one at that (5.1.1). The plugin
 * entry in app.json turns both off (false DELETES the key) and hands the
 * when-in-use key the same specific purpose string as ios.infoPlist.
 *
 *  A. app.json lists the expo-location plugin exactly once, with
 *     locationAlwaysAndWhenInUsePermission: false, locationAlwaysPermission:
 *     false, locationWhenInUsePermission = ios.infoPlist's
 *     NSLocationWhenInUseUsageDescription (verbatim), and no background flag.
 *  B. ios.infoPlist declares no NSLocationAlways* key and no `location`
 *     background mode; every NS…UsageDescription is a specific MAGE ID
 *     sentence (never the generic "Allow $(PRODUCT_NAME)…" template); the
 *     location string still says "never in the background", which A makes true.
 *  C. No source file asks for background location (requestBackgroundPermissionsAsync,
 *     startLocationUpdatesAsync, startGeofencingAsync). If one ever does, A's
 *     `false` would make the request fail on iOS: re-enable the key with a real
 *     purpose string in the same change, and update this validator.
 *  D. (--introspect only; spawns `npx expo config --type introspect`, ~10 s)
 *     The plist prebuild would generate has no NSLocationAlways* key, keeps
 *     the specific when-in-use string, and every NS…UsageDescription in it is
 *     specific. This is the ground truth A and B stand in for.
 *  E. The privacy disclosures App Review reads match the code. Sentry: unless
 *     Sentry.init (app/_layout.tsx) passes breadcrumbsIntegration({ console: false }),
 *     @sentry/react-native's default breadcrumbs ride every error event with
 *     the recent console lines (which can carry an email) and request URLs, so
 *     marketing/privacy.html must say so and never claim log collection is off,
 *     and docs/app-store-metadata.md must declare the three Sentry Diagnostics
 *     rows "Linked to user: Yes". Speech-to-text is a relay to toolkit.rork.com
 *     whose model our code does not name: "provided through Rork", never
 *     "operated by Rork" (matches utils/aiConsentCore.ts). The App Privacy
 *     table declares the company-profile Phone Number and Physical Address
 *     (CompanyBranding.phone / .address). The account-ID sentence is exact:
 *     Sentry.setUser is never called, but a breadcrumb's request address can
 *     carry a user id, so the page says "not deliberately … though it can appear".
 *  F. The third-party list in marketing/privacy.html matches the hosts the
 *     code calls, BOTH ways: a host our code sends user content to (plan PDFs
 *     to CloudConvert; a project's location to OpenStreetMap Nominatim, the
 *     Census geocoder and OpenWeather) is named, and a service the code no
 *     longer calls (Google Maps / Places and Adzuna were removed by the
 *     content-rights wave) is not. --functions / --src point the scan elsewhere.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = join(__dirname, '..');

let failures = 0;
let passes = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { passes++; return; }
  failures++;
  console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
}
const argv = (flag: string): string | null => {
  const i = process.argv.indexOf(flag);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
};

type PluginEntry = string | [string, Record<string, unknown>?];
interface AppJson {
  expo: {
    ios?: { infoPlist?: Record<string, unknown> };
    plugins?: PluginEntry[];
  };
}

const appPath = argv('--app') ?? join(ROOT, 'app.json');
const app = JSON.parse(readFileSync(appPath, 'utf8')) as AppJson;
const plist = app.expo.ios?.infoPlist ?? {};
const whenInUse = plist.NSLocationWhenInUseUsageDescription;

const GENERIC = /\$\(PRODUCT_NAME\)|^Allow\b/;
const ALWAYS_KEYS = ['NSLocationAlwaysUsageDescription', 'NSLocationAlwaysAndWhenInUseUsageDescription'];

/** A purpose string App Review reads as specific: names the app, says why, no template. */
function specific(v: unknown): boolean {
  return typeof v === 'string' && v.startsWith('MAGE ID ') && v.length >= 40 && !GENERIC.test(v);
}

// ── A. The expo-location plugin entry ───────────────────────────────────────
const plugins = app.expo.plugins ?? [];
const name = (p: PluginEntry) => (Array.isArray(p) ? p[0] : p);
const loc = plugins.filter((p) => name(p) === 'expo-location');
check('A. app.json lists the expo-location plugin exactly once', loc.length === 1, String(loc.length));
const entry = loc[0];
const opts = (Array.isArray(entry) ? entry[1] : undefined) ?? {};
check('A. it is the [name, options] form (a bare "expo-location" keeps the generic Always strings)',
  Array.isArray(entry) && typeof entry[1] === 'object' && entry[1] !== null);
check('A. locationAlwaysAndWhenInUsePermission is false (deletes NSLocationAlwaysAndWhenInUseUsageDescription)',
  opts.locationAlwaysAndWhenInUsePermission === false, JSON.stringify(opts.locationAlwaysAndWhenInUsePermission));
check('A. locationAlwaysPermission is false (deletes NSLocationAlwaysUsageDescription)',
  opts.locationAlwaysPermission === false, JSON.stringify(opts.locationAlwaysPermission));
check('A. locationWhenInUsePermission is ios.infoPlist.NSLocationWhenInUseUsageDescription, verbatim',
  typeof opts.locationWhenInUsePermission === 'string' && opts.locationWhenInUsePermission === whenInUse,
  typeof opts.locationWhenInUsePermission === 'string' ? `${opts.locationWhenInUsePermission.slice(0, 60)}…` : String(opts.locationWhenInUsePermission));
for (const flag of ['isIosBackgroundLocationEnabled', 'isAndroidBackgroundLocationEnabled', 'isAndroidForegroundServiceEnabled']) {
  check(`A. ${flag} is not turned on (no code tracks location in the background)`, opts[flag] !== true, JSON.stringify(opts[flag]));
}

// ── B. ios.infoPlist ─────────────────────────────────────────────────────────
for (const k of ALWAYS_KEYS) check(`B. ios.infoPlist declares no ${k}`, !(k in plist));
const modes = plist.UIBackgroundModes;
check('B. no `location` UIBackgroundMode', !(Array.isArray(modes) && modes.includes('location')), JSON.stringify(modes));
const usageKeys = Object.keys(plist).filter((k) => /^NS\w+UsageDescription$/.test(k));
check('B. ios.infoPlist declares the purpose strings (camera, microphone, photos, location, Face ID)',
  ['NSCameraUsageDescription', 'NSMicrophoneUsageDescription', 'NSPhotoLibraryUsageDescription',
    'NSLocationWhenInUseUsageDescription', 'NSFaceIDUsageDescription'].every((k) => usageKeys.includes(k)),
  usageKeys.join(', '));
for (const k of usageKeys) {
  check(`B. ${k} is a specific MAGE ID sentence (not the generic template)`, specific(plist[k]), String(plist[k]).slice(0, 60));
}
check('B. the location purpose string still says it is never used in the background',
  typeof whenInUse === 'string' && /never in the background/i.test(whenInUse));

// ── C. No code asks for background location ─────────────────────────────────
const BACKGROUND_CALLS = /\b(requestBackgroundPermissionsAsync|startLocationUpdatesAsync|startGeofencingAsync)\s*\(/;
const srcRoot = argv('--src') ?? ROOT;
const SRC_DIRS = ['app', 'components', 'utils', 'hooks', 'contexts', 'lib', 'modules', 'constants'];
const SKIP = new Set(['node_modules', '.git', '__tests__', 'ios', 'android', 'build']);
const offenders: string[] = [];
let scanned = 0;
function walk(dir: string): void {
  for (const n of readdirSync(dir)) {
    if (SKIP.has(n)) continue;
    const p = join(dir, n);
    const st = statSync(p);
    if (st.isDirectory()) { walk(p); continue; }
    if (!/\.(tsx?|jsx?)$/.test(n)) continue;
    scanned++;
    const code = readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    if (BACKGROUND_CALLS.test(code)) offenders.push(p.slice(srcRoot.length + 1));
  }
}
for (const d of SRC_DIRS) if (existsSync(join(srcRoot, d))) walk(join(srcRoot, d));
check('C. the source scan read files (it is not silently empty)', scanned >= (argv('--src') ? 1 : 500), String(scanned));
check('C. no source file asks for background location', offenders.length === 0,
  `${offenders.join(', ')} — re-enable the Always key with a real purpose string in app.json, and update this validator`);

// ── D. The plist prebuild would generate (opt-in) ───────────────────────────
if (process.argv.includes('--introspect')) {
  const r = spawnSync('npx', ['expo', 'config', '--type', 'introspect', '--json'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  let ip: Record<string, unknown> = {};
  try {
    ip = (JSON.parse(r.stdout) as { ios?: { infoPlist?: Record<string, unknown> } }).ios?.infoPlist ?? {};
  } catch (e) {
    check('D. expo config --type introspect returns JSON', false, `${(e as Error).message} ${r.stderr.slice(0, 200)}`);
  }
  for (const k of ALWAYS_KEYS) check(`D. the generated Info.plist has no ${k}`, !(k in ip), String(ip[k] ?? ''));
  check('D. the generated NSLocationWhenInUseUsageDescription is app.json\'s specific string',
    ip.NSLocationWhenInUseUsageDescription === whenInUse, String(ip.NSLocationWhenInUseUsageDescription).slice(0, 60));
  const genKeys = Object.keys(ip).filter((k) => /^NS\w+UsageDescription$/.test(k));
  for (const k of genKeys) check(`D. generated ${k} is specific`, specific(ip[k]), String(ip[k]).slice(0, 60));
  console.info(`D. introspected ${genKeys.length} purpose strings: ${genKeys.join(', ')}`);
}

// ── E. Privacy disclosures match the code ──────────────────────────────────
{
  const read = (flag: string, rel: string) => readFileSync(argv(flag) ?? join(ROOT, rel), 'utf8');
  const layout = read('--layout', 'app/_layout.tsx');
  const privacy = read('--privacy', 'marketing/privacy.html');
  const meta = read('--metadata', 'docs/app-store-metadata.md');
  const consoleCrumbsOff = /breadcrumbsIntegration\(\s*\{[^}]*console:\s*false/.test(layout);
  const setsUser = /Sentry\.setUser\s*\(/.test(layout);
  check('E. layout read: Sentry.init is in app/_layout.tsx', /Sentry\.init\s*\(/.test(layout));
  if (!consoleCrumbsOff) {
    check('E. privacy.html never claims Sentry log collection is switched off (console breadcrumbs are on by default)',
      !/internal log messages/i.test(privacy) && !/(switched|turned) off[^.]*\blog/i.test(privacy));
    check('E. privacy.html discloses that a crash report carries recent log lines',
      /recent log lines/i.test(privacy));
  }
  const sentryRows = meta.split('\n').filter((l) => /^\| Diagnostics → (Crash Data|Performance Data|Other Diagnostic Data) \|/.test(l));
  check('E. the App Privacy table has the three Sentry Diagnostics rows', sentryRows.length === 3, String(sentryRows.length));
  if (!consoleCrumbsOff || setsUser) {
    for (const r of sentryRows) {
      check(`E. ${r.split('|')[1].trim()} is "Linked to user: Yes" (log breadcrumbs can carry an email)`,
        r.split('|')[3]?.trim() === 'Yes', r.slice(0, 80));
    }
  }
  check('E. privacy.html never says Rork operates the speech-to-text model', !/operated by Rork/i.test(privacy));
  check('E. privacy.html says speech-to-text is provided through Rork', /provided through Rork/i.test(privacy));
  for (const t of ['Phone Number', 'Physical Address']) {
    check(`E. the App Privacy table declares Contact Info → ${t} (company profile)`,
      new RegExp(`^\\| Contact Info → ${t} \\| Yes \\| Yes \\|`, 'm').test(meta));
  }
}

// ── F. The third-party list matches the hosts the code calls ────────────────
{
  const privacy = readFileSync(argv('--privacy') ?? join(ROOT, 'marketing/privacy.html'), 'utf8');
  const setsUser = /Sentry\.setUser\s*\(/.test(readFileSync(argv('--layout') ?? join(ROOT, 'app/_layout.tsx'), 'utf8'));
  if (!setsUser) {
    check('F. the account-ID sentence is exact: not deliberately attached, but it can appear in a recorded request address',
      /do not deliberately attach your account ID to these reports, though it can appear inside the address of a recorded network request/.test(privacy)
      && !/we do not attach your account ID/i.test(privacy));
  }
  const li = /<h2>Third-Party Services<\/h2>[\s\S]*?<ul>([\s\S]*?)<\/ul>/.exec(privacy)?.[1] ?? '';
  check('F. the Third-Party Services list was found', li.includes('<li>'), String(li.length));
  // What the code really calls: comments removed, so a "RETIRED: Google Places" note is not a call.
  const fnRoot = argv('--functions') ?? join(srcRoot, 'supabase', 'functions');
  let called = '';
  let hostFiles = 0;
  const gather = (dir: string): void => {
    for (const n of readdirSync(dir)) {
      if (SKIP.has(n)) continue;
      const p = join(dir, n);
      const st = statSync(p);
      if (st.isDirectory()) { gather(p); continue; }
      if (!/\.(tsx?|jsx?)$/.test(n)) continue;
      hostFiles++;
      called += '\n' + readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    }
  };
  if (existsSync(fnRoot)) gather(fnRoot);
  for (const d of SRC_DIRS) if (existsSync(join(srcRoot, d))) gather(join(srcRoot, d));
  check('F. the host scan read the edge functions and the app (it is not silently empty)', hostFiles >= (argv('--src') || argv('--functions') ? 1 : 600), String(hostFiles));
  const PROCESSORS: { name: string; listed: RegExp; host: RegExp }[] = [
    { name: 'CloudConvert', listed: /CloudConvert/, host: /api\.cloudconvert\.com/ },
    { name: 'OpenStreetMap (Nominatim)', listed: /OpenStreetMap/, host: /nominatim\.openstreetmap\.org/ },
    { name: 'OpenWeather', listed: /OpenWeather/, host: /api\.openweathermap\.org/ },
    { name: 'U.S. Census Bureau geocoder', listed: /Census/, host: /geocoding\.geo\.census\.gov/ },
    { name: 'Google Maps / Places', listed: /Google (Maps|Places)/, host: /(maps|places)\.googleapis\.com/ },
    { name: 'Adzuna', listed: /Adzuna/, host: /api\.adzuna\.com/ },
  ];
  for (const p of PROCESSORS) {
    const isCalled = p.host.test(called);
    const isListed = p.listed.test(li);
    check(`F. ${p.name}: ${isCalled ? 'the code calls it, so the list names it' : 'the code does not call it, so the list does not name it'}`,
      isCalled === isListed, `called=${isCalled} listed=${isListed}`);
  }
}

if (failures > 0) {
  console.error(`\nvalidate-ios-permission-strings: ${failures} failed, ${passes} passed`);
  process.exit(1);
}
console.info(`validate-ios-permission-strings: all ${passes} checks passed`);
