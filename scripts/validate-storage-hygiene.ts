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

// ── A2 (review 2026-09-05, round 3): those two keys are the ONLY ones the wipe
// may not remove itself ────────────────────────────────────────────────────
// Every other key here is a re-fetchable cache: worst case a wipe races a read
// and the read re-populates it from Supabase. The two write queues are the
// opposite — pending writes that exist nowhere else, with a WRITER (the flush)
// that outlives the wipe. `flushQueuesBeforeSignOut` is bounded by a 20 s
// ceiling; when the ceiling wins, the flush is still in its network phase
// holding a pre-wipe snapshot, and its write-back RE-CREATED the key seconds
// after the multiRemove — with the previous tenant's entries, on a shared
// device, now vouched for by the incoming user's last-user marker. So the wipe
// hands both keys to the module that owns them, which empties them under the
// same lock the write-back takes.
{
  // Comment-stripped: this file's prose (and AuthContext's) describes the OLD
  // multiRemove verbatim, and a negative pin must not be tripped by prose.
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const authNoComments = strip(auth);
  const queueSrc = strip(read('utils/offlineQueue.ts'));
  const photoSrc = strip(read('utils/photoUploadQueue.ts'));

  for (const key of OFFLINE_WRITE_QUEUE_KEYS) {
    ok(`AuthContext never removes ${key} by key`,
      !new RegExp(`(multiRemove|removeItem|setItem)\\([^)]*['"]${key}['"]`).test(authNoComments),
      'touching a write queue outside its lock is how a flush resurrects it');
  }
  ok('AuthContext does not reach for OFFLINE_WRITE_QUEUE_KEYS at all',
    !/OFFLINE_WRITE_QUEUE_KEYS/.test(authNoComments),
    'the list is for selectTenantKeysToWipe to honour, not for a caller to multiRemove');
  ok('the wipe empties both queues through their own locked clear functions',
    /await clearOfflineQueue\(\);/.test(authNoComments) && /await clearPhotoUploadQueue\(\);/.test(authNoComments));
  ok('the prefix sweep is pinned to dropOfflineQueue: false so its multiRemove cannot include them',
    /selectTenantKeysToWipe\(allKeys, \{ dropOfflineQueue: false \}\)/.test(authNoComments),
    'the sweep\'s multiRemove is unlocked; the locked clears above already cover both keys');
  // Coverage is unchanged, only the route: what the sweep no longer removes,
  // the two clear functions do. Assert that, or "don't wipe it here" becomes
  // "don't wipe it".
  const clearedByModule = [
    /AsyncStorage\.removeItem\(OFFLINE_QUEUE_KEY\)/.test(queueSrc) ? 'mageid_offline_queue' : '',
    /AsyncStorage\.removeItem\(PHOTO_QUEUE_KEY\)/.test(photoSrc) ? 'mageid_photo_upload_queue' : '',
  ].filter(Boolean);
  ok('every write-queue key is still emptied by SOMETHING on a sign-out',
    OFFLINE_WRITE_QUEUE_KEYS.every((k) => clearedByModule.includes(k)),
    `not cleared anywhere: ${OFFLINE_WRITE_QUEUE_KEYS.filter((k) => !clearedByModule.includes(k)).join(', ')}`);
  ok('…and each clear runs inside withQueueLock',
    /export async function clearOfflineQueue\(\): Promise<void> \{\s*await withQueueLock\(/.test(queueSrc)
      && /export async function clearPhotoUploadQueue\(\): Promise<void> \{\s*const cleared = await withQueueLock\(/.test(photoSrc),
    'outside the lock this is the same race with extra steps');
  ok('…as does the per-user narrowing AuthContext calls on a marker-less session',
    /export async function retainOfflineQueueForUser\([\s\S]{0,120}?await withQueueLock\(/.test(queueSrc)
      && /export async function retainPhotoUploadQueueForUser\([\s\S]{0,120}?await withQueueLock\(/.test(photoSrc));

  // ── BLOCKING (review 2026-09-05, round 4): the marker backfill NARROWS
  // before it STAMPS ─────────────────────────────────────────────────────────
  // The AuthProvider mount effect writes the last-user marker on an install
  // that pre-dates it. Stamping that marker is exactly what makes an UNTAGGED
  // queue entry adoptable — a flush treats "no tag + the marker names me" as
  // mine (utils/offlineQueue.partitionQueueForSession) — so a backfill that
  // stamps first hands the previous tenant's untagged writes to whoever is
  // signed in now. On web that is reachable today: supabase-js's
  // detectSessionInUrl redeems a recovery link and switches the session at
  // CLIENT CONSTRUCTION, so on a shared browser profile the mount effect can
  // stamp user B over user A's untagged queue, and app/reset-password.tsx's
  // handoff-less onNewSessionEstablished() then reads the marker it just wrote,
  // concludes "same user" and never reaches the narrowing that would have
  // caught it. The retains must therefore come FIRST, in the same continuation.
  const backfillAt = authNoComments.indexOf('void readLastUser().then(');
  const backfill = backfillAt === -1 ? '' : authNoComments.slice(backfillAt, backfillAt + 700);
  ok('the mount-effect last-user backfill is where this guard expects it',
    backfillAt !== -1, 'renamed or restructured — re-read this pin before trusting it');
  {
    const retainText = backfill.indexOf('retainOfflineQueueForUser(');
    const retainPhotos = backfill.indexOf('retainPhotoUploadQueueForUser(');
    const stamp = backfill.indexOf('writeLastUser(');
    ok('the backfill narrows BOTH queues to the arriving user before it stamps the marker',
      retainText !== -1 && retainPhotos !== -1 && stamp !== -1
        && retainText < stamp && retainPhotos < stamp,
      'stamping first makes every untagged entry — possibly the previous tenant\'s, on a shared browser profile — adoptable by the very next flush');

    // A8 (round 5): …and how HARD it narrows is a platform decision, because
    // the leak above needs detectSessionInUrl — a browser-only feature of
    // supabase-js. On native no session can be in front of this effect without
    // a sign-in path having written the marker, so the untagged entries are the
    // session user's own day of field work; dropping them (and unlinking the
    // photo bytes behind them) buys nothing there. Behaviour is executed in
    // __tests__/sync/auth-marker-backfill.test.tsx; what is pinned here is that
    // the gate exists at all — a hard-coded `dropUntagged: true` would pass
    // every one of the assertions above.
    const gate = /const dropUntagged = Platform\.OS === 'web';/.test(backfill);
    ok('…and the narrowing is gated on the platform that can actually leak',
      gate && /retainOfflineQueueForUser\(u\.id, \{ dropUntagged \}\)/.test(backfill)
        && /retainPhotoUploadQueueForUser\(u\.id, \{ dropUntagged \}\)/.test(backfill),
      'either the Platform.OS === \'web\' gate or one of the two calls that consumes it is gone');
    // A8: a read that FAILED is not a queue that was empty. Stamping over a
    // queue this call could not inspect is the same leak by another route.
    const guard = backfill.indexOf('if (text.readFailed || photos.readFailed) {');
    ok('…and a queue that could not be READ leaves the marker unwritten',
      guard !== -1 && guard < stamp,
      'without this the marker goes down over an unreadable queue and every untagged entry in it becomes adoptable');
  }

  // The stricter rule stays where an explicit sign-in has already said this is
  // NOT the same user: onNewSessionEstablished passes NO options, so it gets
  // the default (drop everything untagged) on every platform.
  const establishAt = authNoComments.indexOf('const onNewSessionEstablished = useCallback');
  const establish = establishAt === -1 ? '' : authNoComments.slice(establishAt, establishAt + 4000);
  ok('onNewSessionEstablished still narrows with the STRICT default, on every platform',
    /retainOfflineQueueForUser\(incomingId\),\s*retainPhotoUploadQueueForUser\(incomingId\),/.test(establish),
    'an explicit not-same-user sign-in must not inherit the backfill\'s native leniency');
  ok('…and it too refuses to stamp the marker over a queue it could not read',
    /if \(text\.readFailed \|\| photos\.readFailed\)/.test(establish)
      && /if \(markerUnsafe\)/.test(establish),
    'a swallowed read error here drops the queue AND stamps the marker — the worst of both');
}

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

// ─────────────────────────────────────────────────────────────────────────────
// 5. Every token-redeeming entry point runs the PRE-session identity check
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 5. setSession() outside AuthContext goes through beginSessionFromToken ──');
//
// The magic-link handler (app/_layout.tsx) and the password-reset screen
// (app/reset-password.tsx) redeem a token URL THEMSELVES with
// supabase.auth.setSession(). Calling onNewSessionEstablished() afterwards ran
// the shared-device guard only AFTER the session had switched, so on a shared
// machine the new user's first queries could merge the previous tenant's local
// rows under the new account (SYNC-F13). AuthContext.beginSessionFromToken()
// is the pre-session step — decode the token's claims, flush the previous
// user's queues under THEIR still-active session, wipe their caches — and
// every direct setSession() caller must (a) await it BEFORE setSession and
// (b) hand its verdict to onNewSessionEstablished(handoff) afterwards.
// The reset-password screen had (b) without (a) until 2026-09-05.
const AUTH_HOME = 'contexts/AuthContext.tsx';
const SET_SESSION_RE = /supabase\.auth\.setSession\(/g;
const setSessionCallers: string[] = [];
const unguarded: string[] = [];
for (const file of FILES) {
  const rel = relative(ROOT, file);
  if (rel === AUTH_HOME) continue;
  const code = readFileSync(file, 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  let m: RegExpExecArray | null;
  SET_SESSION_RE.lastIndex = 0;
  while ((m = SET_SESSION_RE.exec(code)) !== null) {
    setSessionCallers.push(rel);
    const guardAt = code.lastIndexOf('await beginSessionFromToken(', m.index);
    const handoffAt = code.indexOf('onNewSessionEstablished(handoff)', m.index);
    const destructured = /\{[^}]*\bbeginSessionFromToken\b[^}]*\}\s*=\s*useAuth\(\)/.test(code);
    if (guardAt === -1 || handoffAt === -1 || !destructured) {
      unguarded.push(`${rel}: ${guardAt === -1 ? 'no await beginSessionFromToken() before setSession' : handoffAt === -1 ? 'verdict not passed to onNewSessionEstablished(handoff)' : 'beginSessionFromToken not taken from useAuth()'}`);
    }
  }
}
ok('setSession() is called outside AuthContext by the two token-redeeming entry points',
  setSessionCallers.includes('app/_layout.tsx') && setSessionCallers.includes('app/reset-password.tsx'),
  `found: ${setSessionCallers.join(', ') || 'none'} — the handlers moved or the scan regex is broken`);
ok('every setSession() outside AuthContext awaits beginSessionFromToken() first and hands the verdict to onNewSessionEstablished(handoff)',
  unguarded.length === 0,
  unguarded.length
    ? `UNGUARDED — the previous tenant's rows can merge under the new session:\n   ${unguarded.join('\n   ')}`
    : '');
ok('no runtime file outside AuthContext redeems a token with beginSessionFromToken missing from its imports',
  FILES.every((f) => {
    const rel = relative(ROOT, f);
    if (rel === AUTH_HOME) return true;
    const src = readFileSync(f, 'utf8');
    return !/supabase\.auth\.setSession\(/.test(src) || /beginSessionFromToken/.test(src);
  }));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
