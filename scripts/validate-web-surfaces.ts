// validate-web-surfaces.ts — guards the three web-surface regressions from
// the 2026-08-31 medium sweep (#26, #31, #32).
//
// All three share one root cause: code written against iOS semantics that
// react-native-web / expo's web shims implement differently, failing SILENTLY
// (a success alert over an empty clipboard, an empty browser tab, an alert
// that says onboarding failed one second after it started). None of them
// throw, so nothing but a static guard catches them coming back.
//
// Run: bun run scripts/validate-web-surfaces.ts
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}

const ROOTS = ['app', 'components', 'hooks', 'contexts', 'utils', 'lib'];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(p)) out.push(p);
  }
  return out;
}

// Strip comments so prose describing an anti-pattern (utils/clipboard.ts's
// header is entirely about this one) doesn't count as a call site.
function codeOf(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const files: string[] = [];
for (const root of ROOTS) {
  try { files.push(...walk(root)); } catch { /* root absent — fine */ }
}

console.log('\nweb surfaces:');

// ── #31: clipboard writes go through utils/clipboard.ts ────────────────────
// `navigator.clipboard?.writeText(x)` returns a Promise nobody awaits, so its
// rejection escapes the surrounding synchronous try/catch; and in a non-secure
// context (http:// on a jobsite LAN, or an embedded iframe) `navigator.clipboard`
// is undefined entirely, so the optional chain short-circuits WITHOUT throwing.
// Both paths reach the "Copied!" toast over an empty clipboard. copyToClipboard()
// awaits, falls back to execCommand('copy'), and returns an honest boolean.
// app/schedule-pro.tsx was missed by the original migration and shipped the bug
// for two audit cycles — hence this guard.
const CLIPBOARD_ALLOW = new Set(['utils/clipboard.ts']);
const clipboardOffenders = files.filter(
  f => !CLIPBOARD_ALLOW.has(f) && /\bnavigator\s*\.\s*clipboard\b/.test(codeOf(f)),
);
ok('no raw navigator.clipboard outside utils/clipboard.ts (silently no-ops on http/iframe)',
  clipboardOffenders.length === 0,
  clipboardOffenders.join('\n      '));

// ── #32: no iOS-only custom URL schemes handed to Linking.openURL ──────────
// react-native-web's Linking shim special-cases only tel:; everything else
// becomes window.open(url, '_blank'), and a desktop browser that registers no
// handler for the scheme opens a blank tab and leaves it there. The https
// universal-link forms (maps.apple.com, google.com/maps) still open the native
// map app on iOS/Android AND render a real page on web.
const SCHEME_RE = /openURL\s*\(\s*[`'"]\s*(maps|comgooglemaps|geo|waze):/;
const schemeOffenders = files.filter(f => SCHEME_RE.test(codeOf(f)));
ok('no iOS-only map: / geo: schemes in Linking.openURL (dead tab on web)',
  schemeOffenders.length === 0,
  schemeOffenders.join('\n      '));

// ── #26: Stripe Connect onboarding branches on web before opening ─────────
// expo-web-browser's web build is `window.open(...); return { type: 'opened' }`
// — it resolves when the tab OPENS, not when it is dismissed. Awaiting it and
// then polling connect-status reports 'incomplete' (connect-onboarding has
// already written stripe_account_id with charges_enabled=false) and pops
// "Setup Not Finished" the same second the flow begins. The web path must open
// and return, leaving the status to the returnUrl round-trip + focus re-poll.
const paymentsSrc = codeOf('app/payments-setup.tsx');
const webOpenAt = paymentsSrc.indexOf('window.open(res.url');
const nativeOpenAt = paymentsSrc.indexOf('WebBrowser.openBrowserAsync(');
ok('payments-setup opens Stripe onboarding on web without awaiting dismissal',
  webOpenAt !== -1 && nativeOpenAt !== -1 && webOpenAt < nativeOpenAt,
  `web open at ${webOpenAt}, WebBrowser.openBrowserAsync at ${nativeOpenAt}`);
ok('payments-setup re-polls connect-status when the web tab regains focus',
  /addEventListener\(\s*'focus'/.test(paymentsSrc)
  && /addEventListener\(\s*'visibilitychange'/.test(paymentsSrc));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
