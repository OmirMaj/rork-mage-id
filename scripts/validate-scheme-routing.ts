// scripts/validate-scheme-routing.ts — pure-fn validator for utils/deepLinkScheme.ts.
//
// Guards the mageid:// migration invariants:
//   • Both the primary (mageid://) and legacy (rork-app://) schemes strip
//     identically, so an old emailed link routes exactly like a new one.
//   • Public paths pass through with their query string; everything else
//     routes to home ('/').
//   • The primary scheme is mageid:// and it's first in APP_SCHEMES (so the
//     native binary registers it as primary while keeping the legacy one).
import {
  stripAppScheme,
  resolveDeepLinkPath,
  PRIMARY_SCHEME,
  LEGACY_SCHEME,
  APP_SCHEMES,
} from '../utils/deepLinkScheme';

let pass = 0, fail = 0;
function eq<T>(n: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, '\n   got ', JSON.stringify(got), '\n   want', JSON.stringify(want)); }
}

// ── Constants ────────────────────────────────────────────────────────────
eq('PRIMARY_SCHEME is mageid://', PRIMARY_SCHEME, 'mageid://');
eq('LEGACY_SCHEME is rork-app://', LEGACY_SCHEME, 'rork-app://');
eq('APP_SCHEMES lists mageid first (primary), rork-app second (legacy)', [...APP_SCHEMES], ['mageid', 'rork-app']);

// ── stripAppScheme: both schemes + bare path normalize identically ───────
eq('strip mageid:// prefix', stripAppScheme('mageid://prequal-form?token=abc'), 'prequal-form?token=abc');
eq('strip rork-app:// prefix (legacy)', stripAppScheme('rork-app://prequal-form?token=abc'), 'prequal-form?token=abc');
eq('strip leading slash (in-app path)', stripAppScheme('/prequal-form?token=abc'), 'prequal-form?token=abc');
eq('bare mageid:// → empty', stripAppScheme('mageid://'), '');
eq('bare rork-app:// → empty', stripAppScheme('rork-app://'), '');
eq('no scheme, no slash → unchanged', stripAppScheme('reset-password?x=1'), 'reset-password?x=1');
// A scheme name appearing mid-path must NOT be stripped (anchored at start).
eq('scheme only stripped at start', stripAppScheme('mageid://a/mageid://b'), 'a/mageid://b');

// ── resolveDeepLinkPath: whitelist passes through, else home ─────────────
eq('mageid:// public path passes through with query', resolveDeepLinkPath('mageid://prequal-form?token=abc'), '/prequal-form?token=abc');
eq('rork-app:// public path passes through (legacy link)', resolveDeepLinkPath('rork-app://prequal-form?token=abc'), '/prequal-form?token=abc');
eq('reset-password (bare) is public', resolveDeepLinkPath('mageid://reset-password'), '/reset-password');
eq('reset-password with query passes through', resolveDeepLinkPath('mageid://reset-password?token=x'), '/reset-password?token=x');
// A #hash-bearing recovery link routes to home; the token in the URL
// fragment is redeemed separately by MagicLinkHandler (a Linking listener),
// NOT by this router. Route extraction splits on '?' only — this matches the
// original native-intent behavior, preserved deliberately through the rename.
eq('reset-password with #hash → home (token handled by MagicLinkHandler)', resolveDeepLinkPath('mageid://reset-password#access_token=x'), '/');
eq('non-public path → home', resolveDeepLinkPath('mageid://qbo-setup'), '/');
eq('legacy non-public path → home', resolveDeepLinkPath('rork-app://claim-crew?token=crew_1'), '/');
eq('bare scheme → home', resolveDeepLinkPath('mageid://'), '/');
eq('empty → home', resolveDeepLinkPath(''), '/');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
