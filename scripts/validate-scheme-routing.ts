// scripts/validate-scheme-routing.ts — pure-fn validator for utils/deepLinkScheme.ts.
//
// Guards the single-scheme (mageid://) routing invariants:
//   • The app scheme strips correctly (and a bare in-app path normalizes the
//     same way), so inbound routing is uniform.
//   • Public paths pass through with their query string; everything else
//     routes to home ('/').
//   • The scheme is mageid:// and APP_SCHEMES lists exactly ['mageid'] (the
//     rork-app:// scaffold scheme was retired pre-launch).
import {
  stripAppScheme,
  resolveDeepLinkPath,
  PRIMARY_SCHEME,
  APP_SCHEMES,
} from '../utils/deepLinkScheme';

let pass = 0, fail = 0;
function eq<T>(n: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, '\n   got ', JSON.stringify(got), '\n   want', JSON.stringify(want)); }
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
eq('non-public path → home', resolveDeepLinkPath('mageid://qbo-setup'), '/');
eq('unknown scheme → home', resolveDeepLinkPath('rork-app://prequal-form?token=abc'), '/');
eq('bare scheme → home', resolveDeepLinkPath('mageid://'), '/');
eq('empty → home', resolveDeepLinkPath(''), '/');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
