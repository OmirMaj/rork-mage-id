// scripts/validate-share-link-host.ts — the public share links must point at
// the host that actually serves them.
//
// WHAT WENT WRONG (found by the 2026-09-13 web-parity audit, confirmed by curl
// the same day). MAGE ID publishes two Netlify sites. `app.mageid.app` runs the
// Expo web build and serves every route under `app/`. `mageid.app` is the
// static marketing site whose catch-all is `/* → /404.html 404`. Three share
// builders composed the marketing host with an Expo route:
//
//     const base = Platform.OS === 'web' ? window.location.origin
//                                        : 'https://mageid.app';
//     const url  = `${base}/shared-estimate?t=${token}`;
//
// On web the ternary saved them. On a phone it did not, and
// `https://mageid.app/shared-estimate?t=…` is a hard 404 — while the GC saw
// "Proposal link copied". Only the client ever saw the failure, and clients do
// not file bug reports. `utils/scheduleReportExport.ts` already knew the right
// answer; three call sites did not.
//
// WHY A GUARD AND NOT JUST A FIX: the shape is trivially re-introducible — the
// marketing host is the correct base for /portal and /sub-portal, so
// 'https://mageid.app' is a legitimate string elsewhere in the tree and cannot
// simply be banned. What must never happen again is that string, or any
// hand-rolled base, meeting a `shared-*` route.
//
// This validator is TWO checks:
//   A. Behaviour — shareLinkBase/buildShareUrl resolve the host correctly,
//      including the adversarial case where the runtime origin IS the
//      marketing host.
//   B. Source — no file composes a `shared-*` URL by hand. Every one goes
//      through buildShareUrl.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  shareLinkBase, buildShareUrl, buildSnapshotShareUrl,
  WEB_APP_ORIGIN, MARKETING_ORIGIN, SHARE_ROUTES,
} from '../utils/webAppOrigin';

let pass = 0, fail = 0;
function eq<T>(n: string, got: T, want: T) {
  const good = JSON.stringify(got) === JSON.stringify(want);
  if (good) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n, '\n   got ', JSON.stringify(got), '\n   want', JSON.stringify(want)); }
}
function ok(n: string, cond: boolean, why?: string) {
  if (cond) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n, why ? `\n      ${why}` : ''); }
}

console.log('\nA. host resolution');

// The two hosts are distinct and neither is empty — the whole guard is
// meaningless if someone "simplifies" them to the same value.
// String() defeats the literal-type narrowing on purpose: tsc can prove these
// two consts differ TODAY and rejects the comparison as unintentional, but the
// point of the assertion is to catch the edit that makes them the same.
ok('WEB_APP_ORIGIN !== MARKETING_ORIGIN', String(WEB_APP_ORIGIN) !== String(MARKETING_ORIGIN),
  `both are ${WEB_APP_ORIGIN}`);
eq('WEB_APP_ORIGIN is the Expo host', WEB_APP_ORIGIN, 'https://app.mageid.app');
eq('MARKETING_ORIGIN is the static host', MARKETING_ORIGIN, 'https://mageid.app');

// Native (no runtime origin) is the case that was broken in production.
eq('no runtime origin → app host', shareLinkBase(undefined), WEB_APP_ORIGIN);
eq('null runtime origin → app host', shareLinkBase(null), WEB_APP_ORIGIN);

// Web honours its own origin, so a dev server and a deploy preview self-link.
eq('localhost dev server self-links', shareLinkBase('http://localhost:8081'), 'http://localhost:8081');
eq('deploy preview self-links', shareLinkBase('https://deploy-preview-12--mageid.netlify.app'),
  'https://deploy-preview-12--mageid.netlify.app');
eq('production web self-links', shareLinkBase('https://app.mageid.app'), 'https://app.mageid.app');
eq('trailing slash trimmed', shareLinkBase('https://app.mageid.app/'), 'https://app.mageid.app');

// THE ADVERSARIAL CASE. If the bundle is ever served from the marketing host,
// honouring the runtime origin would rebuild the exact 404 this file exists to
// prevent. The marketing host is refused as a share base even when the runtime
// hands it over.
eq('marketing host refused as base', shareLinkBase(MARKETING_ORIGIN), WEB_APP_ORIGIN);
eq('marketing host refused (www)', shareLinkBase('https://www.mageid.app'), WEB_APP_ORIGIN);
eq('marketing host refused (trailing slash)', shareLinkBase('https://mageid.app/'), WEB_APP_ORIGIN);
eq('marketing host refused (mixed case)', shareLinkBase('https://MageID.app'), WEB_APP_ORIGIN);

// Junk must not become a base.
eq('empty string → app host', shareLinkBase(''), WEB_APP_ORIGIN);
eq('whitespace → app host', shareLinkBase('   '), WEB_APP_ORIGIN);
eq('origin with a path is not an origin', shareLinkBase('https://app.mageid.app/x'), WEB_APP_ORIGIN);
eq('non-http scheme rejected', shareLinkBase('mageid://app'), WEB_APP_ORIGIN);
eq('bare host rejected', shareLinkBase('app.mageid.app'), WEB_APP_ORIGIN);

console.log('\nB. built URLs');

for (const route of SHARE_ROUTES) {
  eq(`${route} on native`, buildShareUrl(route, 'TOK'), `${WEB_APP_ORIGIN}/${route}?t=TOK`);
  ok(`${route} never on the marketing host`,
    !buildShareUrl(route, 'TOK').startsWith(MARKETING_ORIGIN + '/'));
}
// base64url tokens must survive verbatim — encodeURIComponent leaves -, _ and
// alphanumerics alone, so this is a no-op that documents itself.
eq('base64url token passes through unchanged',
  buildShareUrl('shared-estimate', 'a-b_c123'), `${WEB_APP_ORIGIN}/shared-estimate?t=a-b_c123`);

// The oversize-schedule variant. This is the branch that shipped a HOSTLESS
// string on native, so assert it is absolute, not merely correct-looking.
eq('snapshot variant on native',
  buildSnapshotShareUrl('shared-schedule', 'ab12-cd34'),
  `${WEB_APP_ORIGIN}/shared-schedule?s=ab12-cd34`);
eq('snapshot variant honours the web origin',
  buildSnapshotShareUrl('shared-schedule', 'ab12-cd34', 'http://localhost:8081'),
  'http://localhost:8081/shared-schedule?s=ab12-cd34');
for (const build of [
  () => buildShareUrl('shared-schedule', 'TOK'),
  () => buildSnapshotShareUrl('shared-schedule', 'ID'),
]) {
  ok('every builder returns an absolute URL', /^https?:\/\/[^/]+\/shared-/.test(build()),
    `got ${build()} — a relative path is not a link a client can open`);
}

console.log('\nC. no hand-rolled share URLs in the source tree');

const ROOTS = ['app', 'components', 'utils', 'hooks', 'contexts', 'lib'];
const SELF = 'utils/webAppOrigin.ts';
const files: string[] = [];
function walk(dir: string) {
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return; }
  for (const e of entries) {
    if (e === 'node_modules' || e.startsWith('.')) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.tsx?$/.test(p)) files.push(p);
  }
}
for (const r of ROOTS) walk(r);
ok(`scanned the source tree (${files.length} files)`, files.length > 100,
  `only ${files.length} files found — the walk is probably broken, which would make this check vacuous`);

// A share URL composed from anything other than buildShareUrl.
//
// The FIRST version of this pattern required a base immediately before the
// route — `${base}/shared-x?` or `https://…/shared-x?` — and that was too
// narrow. app/schedule-pro.tsx built the path BARE on one line and prepended
// the origin twenty lines later, inside a `Platform.OS === 'web'` branch with
// no else: on a phone the GC was handed the string `/shared-schedule?t=…`,
// with no host at all, under the words "Open this URL in a laptop browser".
// A line-anchored "base + route" rule cannot see that, so the rule is now
// simply: a `shared-*` route may not appear in a URL-ish string anywhere
// outside webAppOrigin.ts. Navigation by route object/pathname is unaffected —
// only the `?`-bearing literal form the share builders used is matched.
const routeAlt = SHARE_ROUTES.join('|');
const HAND_ROLLED = new RegExp(String.raw`['"\`][^'"\`]*/(?:${routeAlt})\?|\$\{[^}]*\}/(?:${routeAlt})\?`);
const offenders: string[] = [];
for (const f of files) {
  const rel = relative('.', f);
  if (rel === SELF) continue;              // the module that owns the rule
  const src = readFileSync(f, 'utf-8');
  src.split('\n').forEach((line, i) => {
    if (line.trim().startsWith('//') || line.trim().startsWith('*')) return; // prose
    if (HAND_ROLLED.test(line)) offenders.push(`${rel}:${i + 1}  ${line.trim().slice(0, 120)}`);
  });
}
ok('every share URL goes through buildShareUrl', offenders.length === 0,
  offenders.length ? `hand-rolled share URLs:\n      ${offenders.join('\n      ')}` : undefined);

// The guard above is only meaningful if it would actually have caught the
// original bug. Prove it against the literal pre-fix line rather than trusting
// the regex by eye — a guard that cannot fail is not a guard.
const PRE_FIX_LINE = "    const url = `${base}/shared-estimate?t=${token}`;";
ok('the pattern catches the ORIGINAL bug line', HAND_ROLLED.test(PRE_FIX_LINE),
  'the regex no longer matches the code this file was written to forbid');
// The second, subtler shape: a bare relative path made absolute (or not) far
// away from where it was built. This is the one schedule-pro.tsx shipped.
ok('the pattern catches the BARE-PATH bug line',
  HAND_ROLLED.test("      url = `/shared-schedule?t=${result.token}`;"),
  'a relative share path built without a host would go unnoticed again');
ok('the pattern catches a bare path in single quotes',
  HAND_ROLLED.test("      url = '/shared-schedule?t=' + token;"));
ok('the pattern does not flag a buildShareUrl call',
  !HAND_ROLLED.test("    const url = buildShareUrl('shared-estimate', token, null);"));
// /portal and /sub-portal on the marketing host are correct and must stay legal.
ok('the pattern leaves the marketing portal alone',
  !HAND_ROLLED.test("const PORTAL_BASE_URL = 'https://mageid.app/portal';"));

console.log('\nD. links a RECIPIENT opens (prequal invite, crew claim) are https on the app host');

// The same bug a third time, one layer over (2026-09-18 audit, #33). The sub
// prequal invite was `mageid://prequal-form?token=…` and the crew claim magic
// link redirected to `mageid://claim-crew?token=…`. A custom scheme opens only
// where the MAGE ID binary is installed; these links are opened by someone
// ELSE — a sub's office manager in Outlook on Windows, a worker on a laptop —
// so they did nothing, while the GC saw a sent invite. Both routes are public
// Expo routes that work in any browser, so the link must be
// `${shareLinkBase(…)}/<route>?…` on EVERY sender platform. (Switching on
// Platform.OS, as the reset-password link does, would be wrong here: that
// checks the sender's device, not the recipient's.)
const RECIPIENT_ROUTES = ['prequal-form', 'claim-crew'] as const;
const recipientAlt = RECIPIENT_ROUTES.join('|');
// Any URL-ish composition of a recipient route: a quoted/template string
// containing `<route>?`.
const RECIPIENT_URL = new RegExp(String.raw`['"\`][^'"\`]*\b(?:${recipientAlt})\?`);
// The ONE sanctioned form: the route directly after a shareLinkBase(…) base.
const RECIPIENT_OK = new RegExp(String.raw`\$\{shareLinkBase\([^}]*\)\}/(?:${recipientAlt})\?`);
function recipientLineBad(line: string): boolean {
  return RECIPIENT_URL.test(line) && !RECIPIENT_OK.test(line);
}
const recipientOffenders: string[] = [];
const recipientGood: string[] = [];
for (const f of files) {
  const rel = relative('.', f);
  const src = readFileSync(f, 'utf-8');
  src.split('\n').forEach((line, i) => {
    const t = line.trim();
    if (t.startsWith('//') || t.startsWith('*')) return; // prose
    if (recipientLineBad(line)) recipientOffenders.push(`${rel}:${i + 1}  ${t.slice(0, 120)}`);
    else if (RECIPIENT_OK.test(line)) recipientGood.push(rel);
  });
}
ok('no recipient link is built on mageid:// or a hand-rolled host', recipientOffenders.length === 0,
  recipientOffenders.length ? `recipient links not on shareLinkBase:\n      ${recipientOffenders.join('\n      ')}` : undefined);
// Positive pins: the two builders exist and use the sanctioned form. Without
// these, deleting the invite (or moving it somewhere the scan misses) would
// pass the check above vacuously.
ok('prequal invite is built on shareLinkBase (app/prequal-manager.tsx)',
  recipientGood.includes('app/prequal-manager.tsx'));
ok('crew claim redirect is built on shareLinkBase (utils/crewScan.ts)',
  recipientGood.includes('utils/crewScan.ts'));
// Prove the rule against the literal pre-fix lines.
ok('the rule catches the ORIGINAL prequal invite line',
  recipientLineBad("    const link = `${PRIMARY_SCHEME}prequal-form?token=${token}`;"));
ok('the rule catches the ORIGINAL copy-link line',
  recipientLineBad("                    const link = `${PRIMARY_SCHEME}prequal-form?token=${packet.inviteToken}`;"));
ok('the rule catches the ORIGINAL crew claim redirect',
  recipientLineBad("  const redirectTo = `${PRIMARY_SCHEME}claim-crew?token=${encodeURIComponent(claimToken)}`;"));
ok('the rule catches the marketing host',
  recipientLineBad("const link = `https://mageid.app/prequal-form?token=${t}`;"));
ok('the rule accepts the sanctioned form',
  !recipientLineBad("  return `${shareLinkBase(runtimeOrigin)}/prequal-form?token=${encodeURIComponent(token)}`;"));
eq('a native sender still mints the app-host invite',
  `${shareLinkBase(null)}/prequal-form?token=${encodeURIComponent('pq_1')}`,
  `${WEB_APP_ORIGIN}/prequal-form?token=pq_1`);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
