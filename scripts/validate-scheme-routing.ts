// scripts/validate-scheme-routing.ts — pure-fn validator for utils/deepLinkScheme.ts.
//
// Guards the single-scheme (mageid://) routing invariants:
//   • The app scheme strips correctly (and a bare in-app path normalizes the
//     same way), so inbound routing is uniform.
//   • Public paths and well-formed in-app routes pass through with their query
//     string; genuinely malformed/empty paths route to home ('/').
//   • The scheme is mageid:// and APP_SCHEMES lists exactly ['mageid'] (the
//     rork-app:// scaffold scheme was retired pre-launch).
import {
  stripAppScheme,
  resolveDeepLinkPath,
  PRIMARY_SCHEME,
  APP_SCHEMES,
} from '../utils/deepLinkScheme';
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
function eq<T>(n: string, got: T, want: T) {
  const good = JSON.stringify(got) === JSON.stringify(want);
  if (good) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, '\n   got ', JSON.stringify(got), '\n   want', JSON.stringify(want)); }
}
function ok(n: string, cond: boolean, why?: string) {
  if (cond) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n, why ? `\n      ${why}` : ''); }
}

// ── Constants ────────────────────────────────────────────────────────────
eq('PRIMARY_SCHEME is mageid://', PRIMARY_SCHEME, 'mageid://');
eq('APP_SCHEMES is exactly [mageid] (legacy rork-app retired)', [...APP_SCHEMES], ['mageid']);

// ── stripAppScheme ───────────────────────────────────────────────────────
eq('strip mageid:// prefix', stripAppScheme('mageid://prequal-form?token=abc'), 'prequal-form?token=abc');
eq('strip leading slash (in-app path)', stripAppScheme('/prequal-form?token=abc'), 'prequal-form?token=abc');
eq('bare mageid:// → empty', stripAppScheme('mageid://'), '');
eq('no scheme, no slash → unchanged', stripAppScheme('reset-password?x=1'), 'reset-password?x=1');
// A scheme name mid-path must NOT be stripped (anchored at start).
eq('scheme only stripped at start', stripAppScheme('mageid://a/mageid://b'), 'a/mageid://b');
// A foreign/retired scheme is left intact (the OS won't even deliver it to us).
eq('unknown scheme left intact', stripAppScheme('rork-app://prequal-form'), 'rork-app://prequal-form');

// ── resolveDeepLinkPath ──────────────────────────────────────────────────
eq('public path passes through with query', resolveDeepLinkPath('mageid://prequal-form?token=abc'), '/prequal-form?token=abc');
eq('reset-password (bare) is public', resolveDeepLinkPath('mageid://reset-password'), '/reset-password');
eq('reset-password with query passes through', resolveDeepLinkPath('mageid://reset-password?token=x'), '/reset-password?token=x');
// A #hash-bearing recovery link routes to home; the token in the URL fragment
// is redeemed separately by MagicLinkHandler (a Linking listener), NOT by this
// router. Route extraction splits on '?' only.
eq('reset-password with #hash → home (token handled by MagicLinkHandler)', resolveDeepLinkPath('mageid://reset-password#access_token=x'), '/');
eq('well-formed in-app path passes through', resolveDeepLinkPath('mageid://qbo-setup'), '/qbo-setup');
eq('malformed path → home', resolveDeepLinkPath('mageid://!!bad!!'), '/');
eq('unknown scheme → home', resolveDeepLinkPath('rork-app://prequal-form?token=abc'), '/');
eq('bare scheme → home', resolveDeepLinkPath('mageid://'), '/');
eq('empty → home', resolveDeepLinkPath(''), '/');

// ── a custom scheme must never be the ONLY way off a web page ───────────────
// Lives here because a mageid:// navigation that nothing can answer IS a
// scheme-routing failure — it just happens on a screen rather than in a
// pure function.
//
// app/integrations/qbo/callback.tsx is the OAuth redirect target and serves two
// audiences that both report Platform.OS === 'web':
//   (a) iOS's ASWebAuthenticationSession rendering the web build, where
//       navigating to mageid://qbo-setup is exactly right — iOS intercepts it,
//       closes the browser, hands off to the app.
//   (b) An actual browser, where a custom-scheme navigation does nothing.
//
// The page did only (a), and its manual "Open MAGE app" button did the same
// thing — so a web user completed the QuickBooks OAuth successfully and was
// then STRANDED with no route back into the app. The connection was saved and
// they could not see it. Worst kind of dead end: everything worked.
{
  const src = readFileSync('app/integrations/qbo/callback.tsx', 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  ok('qbo callback still attempts the deep link (the in-app-browser path)',
    /window\.location\.href\s*=\s*deepLink/.test(code),
    'without it iOS never gets the handoff and the browser session stays open');

  ok('qbo callback falls back to an IN-APP route on web',
    /router\.replace\(["'']\/qbo-setup["'']\)/.test(code),
    'a real browser cannot follow mageid://, so without an in-app route the ' +
    'user is stranded on the callback page after a SUCCESSFUL connection');

  ok('the manual button does not just repeat the deep link on web',
    /Platform\.OS === "web"[\s\S]{0,120}?router\.replace/.test(code),
    'the fallback affordance must be the reliable one, not a second copy of ' +
    'the navigation that may already have failed');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
