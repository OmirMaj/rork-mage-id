// scripts/validate-storage-hygiene.ts — permanent guard on the local-storage
// tenant boundary. Pins the fix for the 2026-08-17 web audit's P1:
//
//   "stale buildwise_* / tertiary_* localStorage keys are never cleared. They
//    hold real data (change orders, COIs, contacts, subs), the source has zero
//    references to those prefixes, and LOCAL_USER_CACHE_KEYS lists only
//    mageid_* — so logout never clears them."
//
// Three things are asserted, in the order they matter:
//
//   1. LEGACY COVERAGE — every prefix the pre-launch de-brand abandoned
//      (buildwise_, tertiary_) is removed by the clear path.
//   2. NO REGROWTH — no runtime source file writes a legacy-prefixed key, so
//      the old namespaces cannot come back.
//   3. FULL COVERAGE — every storage key the app actually writes is removed by
//      the clear path, or is a DEVICE_SCOPED_KEYS survivor with a stated
//      reason. This is the one that catches the NEXT key someone forgets to
//      register, which is the recurring failure: before this fix the app wrote
//      ~125 mageid_*/mage_* keys and LOCAL_USER_CACHE_KEYS named ~55 of them.
//
// Plus a blast-radius check: on web AsyncStorage IS window.localStorage, so the
// sweep must never remove a key belonging to Supabase / Stripe / RevenueCat /
// Sentry / the marketing site on the same origin, and must never be clear().
//
// Pure node:fs for the source scan + a direct import of the pure decision
// module. No react-native import (that crashes bun).

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import {
  APP_STORAGE_PREFIXES,
  CURRENT_STORAGE_PREFIXES,
  DEVICE_SCOPED_KEYS,
  LEGACY_STORAGE_PREFIXES,
  OFFLINE_WRITE_QUEUE_KEYS,
  UNNAMESPACED_APP_KEY_PREFIXES,
  isAppStorageKey,
  selectTenantKeysToWipe,
} from '../utils/localCacheKeys';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

let pass = 0, fail = 0;
function ok(n: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, extra ? `\n   ${extra}` : ''); }
}
const read = (p: string): string => { try { return readFileSync(join(ROOT, p), 'utf8'); } catch { return ''; } };

// Directories that ship in the app bundle. scripts/ and docs/ are excluded on
// purpose: this file and the audit write-ups legitimately name the legacy
// prefixes, and neither ships to a user's browser.
const RUNTIME_DIRS = ['app', 'components', 'contexts', 'hooks', 'lib', 'utils', 'constants', 'types'];

// The one runtime file allowed to name a legacy prefix — it is where the sweep
// list lives. Asserted below to name them ONLY inside LEGACY_STORAGE_PREFIXES.
const LEGACY_PREFIX_HOME = 'utils/localCacheKeys.ts';

function walk(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    if (name === 'node_modules') continue;
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) out.push(...walk(full));
    else if (name.endsWith('.ts') || name.endsWith('.tsx')) out.push(full);
  }
  return out;
}
const FILES = RUNTIME_DIRS.flatMap((d) => walk(join(ROOT, d)));

// ─────────────────────────────────────────────────────────────────────────────
// Key discovery — what the app actually writes
// ─────────────────────────────────────────────────────────────────────────────
//
// Two independent passes, unioned, because the codebase does both:
//   (a) named consts   — `const FOO_KEY = 'bids_home_state'`
//   (b) inline strings — `AsyncStorage.getItem('mage_bids')`, and every literal
//       that already carries an app prefix.
// Pass (a) is what catches keys with NO app prefix, which pass (b) cannot see.

const KEY_CONST_RE = /(?:export\s+)?const\s+[A-Z0-9_]*(?:KEY|KEYS|PREFIX)[A-Z0-9_]*\s*(?::[^=]+)?=\s*'([^']+)'/g;
const PREFIXED_LITERAL_RE = /['"`]((?:mageid_|mage_|buildwise_|tertiary_)[a-zA-Z0-9_:.-]*)['"`]/g;
const DIRECT_CALL_RE = /AsyncStorage\.(?:getItem|setItem|removeItem|mergeItem)\(\s*'([^']+)'/g;

// Literals a *_KEY / *_PREFIX const name catches that are NOT local-storage
// keys. Every entry is a real, verified non-key; the assertions below refuse to
// let this set hide anything app-prefixed or anything already deleted.
const NOT_STORAGE_KEYS = new Map<string, string>([
  ['EXPO_PUBLIC_OPENWEATHER_API_KEY', 'utils/weatherService.ts — the NAME of an env var, not a key'],
  ['qbo-cost-lines', 'hooks/useQboCostLines.ts — a react-query cache key (in memory)'],
  ['seed:', 'utils/costSeedCore.ts — prefix of a synthetic project id, not a storage key'],
  ['shift-alert:', 'hooks/useTimeEntries.ts — prefix of a local-notification identifier'],
  ['Pre-CO', 'utils/coScheduleReflowCore.ts — a schedule baseline NAME'],
  ['standalone', 'utils/takeoffStorage.ts — project-id placeholder INSIDE the composite mageid_takeoff:: key'],
]);

const discovered = new Map<string, string>(); // key -> first file that writes it
function collect(file: string, re: RegExp, src: string) {
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const key = m[1];
    if (!key || NOT_STORAGE_KEYS.has(key)) continue;
    if (!discovered.has(key)) discovered.set(key, relative(ROOT, file));
  }
}
for (const file of FILES) {
  // LEGACY_PREFIX_HOME declares PREFIXES, not keys, and quotes real legacy key
  // names in its prose. Scanning it would report the sweep list as if the app
  // still wrote those keys. Section 2 checks that file separately and exactly.
  if (relative(ROOT, file) === LEGACY_PREFIX_HOME) continue;
  const src = readFileSync(file, 'utf8');
  collect(file, KEY_CONST_RE, src);
  collect(file, PREFIXED_LITERAL_RE, src);
  collect(file, DIRECT_CALL_RE, src);
}

console.log('\n── 0. discovery sanity ───────────────────────────────────────');
ok(`scanned ${FILES.length} runtime source files`, FILES.length > 500, `only ${FILES.length}`);
ok(`discovered ${discovered.size} storage keys the app writes`, discovered.size > 100, `only ${discovered.size}`);
// Anchor on keys we know exist, so a silently-broken regex can't turn this
// whole validator into a no-op that passes.
for (const anchor of ['mageid_projects', 'mageid_change_orders', 'mage_cashflow_data', 'bids_home_state', 'post-rfp:draft:']) {
  ok(`discovery found ${anchor}`, discovered.has(anchor), 'key-discovery regex is broken');
}
for (const [k, why] of NOT_STORAGE_KEYS) {
  ok(`NOT_STORAGE_KEYS entry ${JSON.stringify(k)} is not app-prefixed`, !isAppStorageKey(k),
    'an app-prefixed key cannot be excused as "not a storage key"');
  ok(`NOT_STORAGE_KEYS entry ${JSON.stringify(k)} still exists in source`,
    FILES.some((f) => readFileSync(f, 'utf8').includes(`'${k}'`)), `stale exclusion — ${why}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Legacy coverage — the audit's actual finding
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 1. legacy prefixes are covered by the clear path ──────────');

// The complete set the de-brand renamed (commit 0dfbce0: "buildwise_* (10 keys)
// → mageid_*, tertiary_* (64 keys) → mageid_*"). If a third legacy prefix is
// ever discovered, it goes here AND in LEGACY_STORAGE_PREFIXES.
const DEBRANDED_PREFIXES = ['buildwise_', 'tertiary_'];
for (const p of DEBRANDED_PREFIXES) {
  ok(`LEGACY_STORAGE_PREFIXES includes ${p}`, (LEGACY_STORAGE_PREFIXES as readonly string[]).includes(p));
}
ok('LEGACY_STORAGE_PREFIXES has no extra, unexplained prefix',
  LEGACY_STORAGE_PREFIXES.length === DEBRANDED_PREFIXES.length,
  `got ${JSON.stringify(LEGACY_STORAGE_PREFIXES)}`);

// Real key names from the de-brand commit + the four collections the audit
// found still populated on a live account.
const LEGACY_KEYS_ON_DISK = [
  'buildwise_projects', 'buildwise_settings', 'buildwise_user_role',
  'buildwise_onboarding_complete', 'buildwise_stripe_nudge_seen',
  'buildwise_margin_alerts_baseline', 'buildwise_gantt_color_mode',
  'tertiary_change_orders', 'tertiary_cois', 'tertiary_contacts',
  'tertiary_subcontractors', 'tertiary_invoices', 'tertiary_photos',
  'tertiary_daily_reports', 'tertiary_punch_items', 'tertiary_safety_incidents',
];
const wipedLegacy = selectTenantKeysToWipe(LEGACY_KEYS_ON_DISK);
ok(`all ${LEGACY_KEYS_ON_DISK.length} known legacy keys are wiped`,
  wipedLegacy.length === LEGACY_KEYS_ON_DISK.length,
  `survivors: ${LEGACY_KEYS_ON_DISK.filter((k) => !wipedLegacy.includes(k)).join(', ')}`);
ok('legacy keys are wiped even on a same-user re-auth (dropOfflineQueue: false)',
  selectTenantKeysToWipe(LEGACY_KEYS_ON_DISK, { dropOfflineQueue: false }).length === LEGACY_KEYS_ON_DISK.length,
  'the offline-queue exemption must not shelter legacy residue');

// The clear path has to actually run the sweep.
const auth = read('contexts/AuthContext.tsx');
ok('AuthContext.tsx loaded', auth.length > 0);
ok('wipeLocalUserCache calls selectTenantKeysToWipe over getAllKeys()',
  /getAllKeys\(\)/.test(auth) && /selectTenantKeysToWipe\(/.test(auth),
  'the sweep is the only thing that covers un-enumerated keys');
ok('the sweep result is passed to multiRemove',
  /multiRemove\(\s*doomed\s*\)/.test(auth));
ok('wipeLocalUserCache still runs on every auth transition',
  (auth.match(/await wipeLocalUserCache\(/g) ?? []).length >= 10,
  'logout / deleteAccount / sign-in / OAuth must all wipe');

// ─────────────────────────────────────────────────────────────────────────────
// 2. No regrowth — the old prefixes cannot come back
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 2. no source file writes a legacy-prefixed key ────────────');

const legacyWriters: string[] = [];
for (const file of FILES) {
  const rel = relative(ROOT, file);
  if (rel === LEGACY_PREFIX_HOME) continue;
  const src = readFileSync(file, 'utf8');
  for (const line of src.split('\n')) {
    const t = line.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) continue; // prose may cite them
    if (/['"](?:buildwise_|tertiary_)[a-zA-Z0-9_]/.test(line)) legacyWriters.push(`${rel}: ${t}`);
  }
}
ok('zero runtime files reference a legacy-prefixed key literal',
  legacyWriters.length === 0, legacyWriters.slice(0, 5).join('\n   '));
for (const p of DEBRANDED_PREFIXES) {
  ok(`no discovered key starts with ${p}`,
    ![...discovered.keys()].some((k) => k.startsWith(p)),
    [...discovered.keys()].filter((k) => k.startsWith(p)).join(', '));
}
// The one file allowed to name them must only do so as sweep prefixes.
const home = read(LEGACY_PREFIX_HOME);
ok(`${LEGACY_PREFIX_HOME} names the legacy prefixes only inside LEGACY_STORAGE_PREFIXES`,
  /export const LEGACY_STORAGE_PREFIXES = \['buildwise_', 'tertiary_'\] as const;/.test(home),
  'the sweep list must be a literal, greppable declaration');

// ─────────────────────────────────────────────────────────────────────────────
// 3. Full coverage — catch the NEXT forgotten key
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 3. the clear path covers every key the app writes ─────────');

const survivors = new Set<string>(DEVICE_SCOPED_KEYS);
const uncovered: string[] = [];
for (const [key, file] of discovered) {
  if (survivors.has(key)) continue;
  // A key literal may be a whole key or a dynamic-suffix prefix; both must go.
  const wiped = selectTenantKeysToWipe([key, `${key}probe`]);
  if (wiped.length !== 2) uncovered.push(`${key}  (written by ${file})`);
}
ok(`all ${discovered.size - survivors.size} written keys are removed on tenant switch`,
  uncovered.length === 0,
  uncovered.length
    ? `NOT cleared — these survive logout and leak to the next tenant:\n   ${uncovered.join('\n   ')}\n   Fix: give the key an app prefix, or add its prefix to utils/localCacheKeys.ts`
    : '');

// DEVICE_SCOPED_KEYS is the ONE way to exempt a key from the wipe, so it is
// pinned here as an exact set. Without this pin the coverage check above is
// trivially silenceable: drop `mageid_change_orders` into DEVICE_SCOPED_KEYS
// and the loop just skips it. Adding a survivor is a decision to leave data
// behind for the next tenant, so it has to be made in two places at once.
const EXPECTED_DEVICE_SCOPED = ['mageid_theme', 'mage_analytics_distinct_id'];
const added = DEVICE_SCOPED_KEYS.filter((k) => !EXPECTED_DEVICE_SCOPED.includes(k));
const removed = EXPECTED_DEVICE_SCOPED.filter((k) => !DEVICE_SCOPED_KEYS.includes(k));
ok('DEVICE_SCOPED_KEYS is exactly the reviewed survivor set',
  added.length === 0 && removed.length === 0,
  [
    added.length ? `NEWLY EXEMPTED from the tenant wipe: ${added.join(', ')}` : '',
    removed.length ? `no longer exempt: ${removed.join(', ')}` : '',
    'every survivor is data left behind for the next user on a shared device.',
    'If the exemption is right, justify it in utils/localCacheKeys.ts AND add it',
    'to EXPECTED_DEVICE_SCOPED here.',
  ].filter(Boolean).join('\n   '));

// Every survivor must be a key the app really writes, and must be justified in
// the module. A survivor nobody writes is a stale exemption.
for (const k of DEVICE_SCOPED_KEYS) {
  ok(`device-scoped survivor ${k} is actually written by the app`, discovered.has(k),
    'stale exemption — remove it from DEVICE_SCOPED_KEYS');
  ok(`device-scoped survivor ${k} survives the sweep`, selectTenantKeysToWipe([k]).length === 0);
}

// Offline write queue: dropped on sign-out, kept on same-user re-auth.
ok('offline write queues are dropped on a deliberate sign-out',
  selectTenantKeysToWipe(OFFLINE_WRITE_QUEUE_KEYS).length === OFFLINE_WRITE_QUEUE_KEYS.length);
ok('offline write queues survive a same-user re-auth',
  selectTenantKeysToWipe(OFFLINE_WRITE_QUEUE_KEYS, { dropOfflineQueue: false }).length === 0);

// ─────────────────────────────────────────────────────────────────────────────
// 4. Blast radius — the sweep must not touch anyone else's keys
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 4. the sweep cannot touch foreign keys on the origin ──────');

const FOREIGN_ORIGIN_KEYS = [
  // Supabase's own session, written through `storage: AsyncStorage`
  // (lib/supabase.ts). Removing this signs the user out mid-handler.
  'sb-jvxaqvyilkqfyjuhpwrq-auth-token',
  'sb-jvxaqvyilkqfyjuhpwrq-auth-token-code-verifier',
  '__stripe_mid', '__stripe_sid',                 // js.stripe.com iframe
  'rc_anonymous_id', 'com.revenuecat.userdefaults', // RevenueCat web billing
  'sentryReplaySession',                           // @sentry/react-native web
  'mage-screenshot-preset',                        // marketing/ — hyphen, not mage_
  'portal_schedule_view',                          // marketing/portal/
  'theme', 'i18nextLng', 'debug',                  // generic third-party
  // Near-misses that prove the prefix boundary is exact, not fuzzy.
  'magenta_swatch', 'mageid', 'mage', 'buildwiseless', 'tertiaryish',
];
const collateral = selectTenantKeysToWipe(FOREIGN_ORIGIN_KEYS);
ok('the sweep removes ZERO foreign keys', collateral.length === 0,
  `would have deleted: ${collateral.join(', ')}`);
ok('a Supabase session key is not app-owned', !isAppStorageKey('sb-abc-auth-token'));
ok('mageid_ and mage_ are disjoint prefixes',
  !'mageid_projects'.startsWith('mage_') && !'magenta_x'.startsWith('mage_'));
const authCode = auth.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
ok('AuthContext never calls AsyncStorage.clear()', !/AsyncStorage\.clear\(/.test(authCode),
  'clear() would nuke the Supabase session and every third-party SDK on the web origin');
ok('the clear path is prefix-scoped, not app-scoped',
  APP_STORAGE_PREFIXES.every((p) => p.length >= 5),
  `a short prefix would over-match on a shared origin: ${APP_STORAGE_PREFIXES.filter((p) => p.length < 5).join(', ')}`);
ok('every current prefix is still written by the app',
  CURRENT_STORAGE_PREFIXES.every((p) => [...discovered.keys()].some((k) => k.startsWith(p))));
ok('every un-namespaced app key prefix is still written by the app',
  UNNAMESPACED_APP_KEY_PREFIXES.every((p) => [...discovered.keys()].some((k) => k.startsWith(p))),
  `stale: ${UNNAMESPACED_APP_KEY_PREFIXES.filter((p) => ![...discovered.keys()].some((k) => k.startsWith(p))).join(', ')}`);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
