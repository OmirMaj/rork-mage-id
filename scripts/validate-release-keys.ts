// validate-release-keys.ts — no sandbox or placeholder credential may ride a
// release profile out of this repo.
//
// WHY THIS EXISTS. On 2026-09-10 a go-to-market review checked the money path
// instead of reading the code around it, and found `eas.json` carrying
//
//     "EXPO_PUBLIC_REVENUECAT_WEB_API_KEY": "rcb_sb_…"
//
// in BOTH the production and preview profiles. `rcb_sb_` is RevenueCat's
// sandbox Web Billing form; production is `rcb_` with no `sb`. Every other key
// in that file was live (`appl_`, `goog_`), so only web was wrong — which is
// also the surface a marketing link sends a stranger to.
//
// Nothing caught it, and nothing could have:
//
//   * contexts/SubscriptionContext.isKeyValidForPlatform tests
//     `key.startsWith('rcb_')`, and `'rcb_sb_…'.startsWith('rcb_')` is TRUE. A
//     sandbox key passed the one pre-flight that existed.
//   * The SDK then initialises cleanly, offerings load, the paywall renders.
//     The only thing that does not happen is a charge. There is no error, no
//     crash, and no empty state — the failure is invisible from the inside.
//
// The app had ~1 install and 0 paid conversions across 180 days, and had been
// reasoning about product-market fit on that number. A zero produced by a till
// that cannot ring is not evidence about a market.
//
// WHAT THIS CHECKS. Every env value in a RELEASE-shaped eas.json profile
// (production / preview — the ones whose builds reach a person who is not the
// developer) must not look like a sandbox or placeholder credential. Dev and
// simulator profiles are left alone: a sandbox key is the CORRECT value there.
//
// Deliberately NOT checked: whether a key is the RIGHT production key. This
// script cannot know that and must not pretend to — it only asserts that the
// value does not announce itself as non-production.
//
// Run via: bun run scripts/validate-release-keys.ts

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0;
let fail = 0;

function ok(name: string, cond: boolean, why?: string): void {
  if (cond) { pass++; console.log('  ✓', name); return; }
  fail++;
  console.log('  ✗', name);
  if (why) console.log('        ' + why);
}

/**
 * Profiles whose output reaches someone other than the person building it.
 * `preview` counts: it is the TestFlight/internal channel, and a tester who
 * cannot buy reports "the paywall is broken" rather than the truth.
 */
const RELEASE_PROFILES = ['production', 'preview'];

/**
 * Markers that say "this credential is not for real money", in the forms the
 * vendors this app uses actually emit.
 *
 * `_sb_` / `sb_` — RevenueCat sandbox (rcb_sb_…).
 * `_test_` / `test_` — Stripe and several others (sk_test_, pk_test_).
 * The placeholder words catch a key someone pasted a reminder into.
 *
 * Matched case-insensitively against the VALUE, never the var name: a var
 * legitimately called ..._TEST_API_KEY is allowed to hold a test key, and
 * that is exactly what EXPO_PUBLIC_REVENUECAT_TEST_API_KEY is for.
 */
const NON_PRODUCTION_MARKERS: [RegExp, string][] = [
  [/(^|_)sb_/i, 'RevenueCat sandbox (production is the same prefix without "sb")'],
  [/(^|_)test_/i, 'a test credential (Stripe and others use sk_test_ / pk_test_)'],
  [/\b(placeholder|changeme|your[-_]?key|xxx+|todo)\b/i, 'a placeholder, not a credential'],
];

/** Var names whose whole purpose is to hold a non-production value. */
const INTENTIONALLY_NON_PRODUCTION = /(_TEST_|_SANDBOX_|_DEV_)/;

console.log('\nrelease profiles carry no sandbox credentials:');

const easPath = join(ROOT, 'eas.json');
ok('eas.json exists', existsSync(easPath), 'nothing to check — has the build config moved?');

if (existsSync(easPath)) {
  const eas = JSON.parse(readFileSync(easPath, 'utf8')) as {
    build?: Record<string, { env?: Record<string, string> }>;
  };
  const build = eas.build ?? {};

  ok('the release profiles are still named in eas.json',
    RELEASE_PROFILES.every(p => p in build),
    `expected ${RELEASE_PROFILES.join(', ')}; found ${Object.keys(build).join(', ')}. ` +
    'If a profile was renamed, rename it here too or this check silently covers nothing.');

  const offenders: string[] = [];
  for (const profile of RELEASE_PROFILES) {
    const env = build[profile]?.env ?? {};
    for (const [name, value] of Object.entries(env)) {
      if (typeof value !== 'string' || !value) continue;
      if (INTENTIONALLY_NON_PRODUCTION.test(name)) continue;
      for (const [marker, meaning] of NON_PRODUCTION_MARKERS) {
        if (marker.test(value)) {
          offenders.push(`${profile}.env.${name} = "${value.slice(0, 10)}…" — ${meaning}`);
          break;
        }
      }
    }
  }

  ok('no release profile carries a sandbox or placeholder credential',
    offenders.length === 0,
    offenders.join('\n        ') +
    '\n        A build made from this profile reaches someone who is not you, and a ' +
    'sandbox credential there fails INVISIBLY — the SDK configures, the screen renders, ' +
    'and only the charge never happens.');
}

// ── the runtime half: the app must SAY so, not sail past it ────────────────
//
// The guard above stops the value shipping. This one stops the code from
// treating it as fine if it ever does — `isKeyValidForPlatform` could not,
// because 'rcb_sb_…'.startsWith('rcb_') is true.
{
  const src = readFileSync(join(ROOT, 'contexts', 'SubscriptionContext.tsx'), 'utf8');
  ok('the subscription context can recognise a sandbox key at all',
    /function isSandboxKey\(/.test(src),
    'without this, a sandbox key passes isKeyValidForPlatform and configures silently');
  ok('…and a release build says so loudly rather than continuing quietly',
    /!__DEV__ && isSandboxKey\(apiKey\)/.test(src) && /console\.error\(/.test(src),
    'a console.log here would scroll past; this is a broken till, not a note');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.error('\n✗ validate-release-keys: a release build would ship a credential that cannot take money.\n');
  process.exit(1);
}
