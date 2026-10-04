// scripts/validate-ios-store-copy.ts — what the iPhone app may not say (first
// App Store submission, audit findings 7, 8 and 11).
//
//   2.3.10  An iOS app must not name another mobile platform: no "Android",
//           "Google Play" or "Play Store" anywhere an iPhone user can read it.
//   3.1.1   No route to a plan outside in-app purchase: a paid plan with no
//           App Store purchase is just its name — never "turned on by MAGE ID",
//           never "nothing to cancel in the App Store", never "email us to
//           change your plan".
//   2.1     No feature that doesn't exist: "Priority queue on heavy AI
//           requests" is gone everywhere.
//
// How. Every string in the owned files that names those things lives in a
// small copy function that branches on Platform.OS (the web app and Android
// keep their own wording). This file
//   1. fails any such word, outside comments, that is NOT inside one of those
//      registered functions (so a new string in JSX cannot slip past), and
//   2. RUNS each function — sliced out of the real source, transpiled by bun —
//      with Platform.OS = 'ios', and fails if the iPhone text names any of
//      them; then runs the web branch to prove the web app's wording is kept.
//
// Run: bun run scripts/validate-ios-store-copy.ts

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

declare const Bun: {
  Transpiler: new (opts: { loader: 'ts' }) => { transformSync(code: string): string };
};

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}

const BANNED = /Android|Google Play|Play Store|play\.google|turned on by MAGE ID|turned your plan on|nothing to cancel in the App Store|Priority queue/g;
const NEVER_ANYWHERE = /Priority queue/i;

/** Comments blanked (line structure kept); string contents untouched. */
function stripComments(src: string): string {
  let out = '';
  let i = 0;
  let mode: 'code' | 'line' | 'block' | 'sq' | 'dq' | 'bt' = 'code';
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (mode === 'code') {
      if (c === '/' && n === '/') { mode = 'line'; out += '  '; i += 2; continue; }
      if (c === '/' && n === '*') { mode = 'block'; out += '  '; i += 2; continue; }
      if (c === "'") mode = 'sq'; else if (c === '"') mode = 'dq'; else if (c === '`') mode = 'bt';
      out += c; i++; continue;
    }
    if (mode === 'line') { if (c === '\n') { mode = 'code'; out += c; } else out += ' '; i++; continue; }
    if (mode === 'block') { if (c === '*' && n === '/') { mode = 'code'; out += '  '; i += 2; continue; } out += c === '\n' ? c : ' '; i++; continue; }
    if (c === '\\') { out += c + (n ?? ''); i += 2; continue; }
    if ((mode === 'sq' && c === "'") || (mode === 'dq' && c === '"') || (mode === 'bt' && c === '`')) mode = 'code';
    if ((mode === 'sq' || mode === 'dq') && c === '\n') mode = 'code';
    out += c; i++;
  }
  return out;
}

/** [start, end) of a top-level `function name(` declaration, braces matched. */
function fnRange(src: string, name: string): [number, number] | null {
  const m = new RegExp(`\\nfunction ${name}\\(`).exec(src);
  if (!m) return null;
  const start = m.index + 1;
  // Skip the parameter list and an optional return type to the body brace.
  let p = src.indexOf('(', start);
  let paren = 0;
  for (; p < src.length; p++) {
    if (src[p] === '(') paren++;
    else if (src[p] === ')') { paren--; if (paren === 0) break; }
  }
  const open = src.indexOf('{', p);
  let depth = 0;
  for (let q = open; q < src.length; q++) {
    if (src[q] === '{') depth++;
    else if (src[q] === '}') { depth--; if (depth === 0) return [start, q + 1]; }
  }
  return null;
}

/** A top-level `const NAME ... ;` declaration (one statement). */
function constDecl(src: string, name: string): string {
  const m = new RegExp(`\\nconst ${name}\\b[^\\n]*\\n?`).exec(src);
  if (!m) return '';
  const end = src.indexOf(';', m.index);
  return src.slice(m.index + 1, end + 1);
}

const transpiler = new Bun.Transpiler({ loader: 'ts' });

/** Build the registered functions from source, with a fake Platform. */
function load(src: string, fns: string[], consts: string[], os: string): Record<string, (...a: unknown[]) => unknown> {
  const parts = [...consts.map((c) => constDecl(src, c)), ...fns.map((f) => { const r = fnRange(src, f); return r ? src.slice(r[0], r[1]) : ''; })];
  const js = transpiler.transformSync(parts.join('\n\n'));
  const make = new Function('Platform', `${js}\nreturn { ${fns.join(', ')} };`);
  return make({ OS: os }) as Record<string, (...a: unknown[]) => unknown>;
}

type Owned = { file: string; fns: string[]; consts?: string[] };
const OWNED: Owned[] = [
  {
    file: 'app/(tabs)/settings/index.tsx',
    fns: ['privacyFaqAnswer', 'ipadFaqAnswer', 'subscriptionFaqAnswer', 'deleteAccountSubscriptionNote', 'planChangeRouteFor'],
    consts: ['PLAN_NAME'],
  },
  { file: 'components/HelpFab.tsx', fns: ['helpEmailPlatformTag'] },
  { file: 'app/notifications-settings.tsx', fns: ['pushHowItWorks'] },
];

console.log('\n── 1. no banned word outside a Platform copy function ──');
for (const o of OWNED) {
  const raw = read(o.file);
  const code = stripComments(raw);
  const ranges = o.fns.map((f) => fnRange(code, f));
  ok(`${o.file}: every copy function exists`, ranges.every(Boolean), o.fns.filter((_, i) => !ranges[i]).join(', '));
  const stray: string[] = [];
  for (const m of code.matchAll(BANNED)) {
    const at = m.index ?? 0;
    const inside = ranges.some((r) => r && at >= r[0] && at < r[1]);
    if (!inside || NEVER_ANYWHERE.test(m[0])) {
      const line = code.slice(0, at).split('\n').length;
      stray.push(`${o.file}:${line} "${m[0]}"`);
    }
  }
  ok(`${o.file}: no stray Android / Google Play / by-hand-plan / Priority queue text`, stray.length === 0, stray.join('\n      '));
}

console.log('\n── 2. the iPhone text, run for real (Platform.OS = ios) ──');
const clean = (s: unknown) => !new RegExp(BANNED.source).test(typeof s === 'string' ? s : JSON.stringify(s));
{
  const src = stripComments(read(OWNED[0].file));
  const ios = load(src, OWNED[0].fns, OWNED[0].consts ?? [], 'ios');
  ok('settings FAQ "Is my data private?" (ios): names AI sharing, only with permission',
    clean(ios.privacyFaqAnswer()) && /only after you allow it/.test(String(ios.privacyFaqAnswer())) && !/never share/i.test(String(ios.privacyFaqAnswer())));
  ok('settings FAQ iPad (ios): no Android', clean(ios.ipadFaqAnswer()) && /iPhone/.test(String(ios.ipadFaqAnswer())));
  const sub = String(ios.subscriptionFaqAnswer());
  ok('settings FAQ subscription (ios): App Store only, no by-hand plan, no email-to-change', clean(sub) && /App Store/.test(sub) && !/help@mageid|email/i.test(sub));
  ok('delete-account note (ios): Apple ID only', clean(ios.deleteAccountSubscriptionNote()) && /Apple ID/.test(String(ios.deleteAccountSubscriptionNote())));
  const routes: string[] = [];
  for (const source of ['store', 'manual', 'none']) for (const tier of ['pro', 'business', 'enterprise']) routes.push(JSON.stringify(ios.planChangeRouteFor(source, tier)));
  ok('plan row (ios), every plan source and tier: no banned words', routes.every(clean), routes.find((r) => !clean(r)) ?? '');
  const hand = ios.planChangeRouteFor('manual', 'business') as { url: string | null; label: string; subtitle: string | null; downgradeMessage: string };
  ok('plan row (ios), paid with no App Store purchase: just "Business plan", not a button', hand.url === null && hand.label === 'Business plan' && hand.subtitle === null);
  ok('…and no email-to-change instruction anywhere in it', !/help@mageid|mailto|email/i.test(JSON.stringify(hand)));
  const store = ios.planChangeRouteFor('store', 'pro') as { url: string; label: string };
  ok('plan row (ios), App Store subscriber: Manage subscription → the App Store page', store.label === 'Manage subscription' && /^itms-apps:\/\/apps\.apple\.com/.test(store.url));
  const help = load(stripComments(read(OWNED[1].file)), OWNED[1].fns, [], 'ios');
  ok('HelpFab support email tag (ios): "iOS"', help.helpEmailPlatformTag() === 'iOS');
  const push = load(stripComments(read(OWNED[2].file)), OWNED[2].fns, [], 'ios');
  ok('Notifications "How push works" (ios): "Your iPhone registers…"', clean(push.pushHowItWorks()) && /^Your iPhone registers/.test(String(push.pushHowItWorks())));
}

console.log('\n── 3. Android reads its own store; the web app keeps today’s words ──');
{
  const src = stripComments(read(OWNED[0].file));
  const and = load(src, OWNED[0].fns, OWNED[0].consts ?? [], 'android');
  ok('android FAQ subscription names Google Play, not the App Store', /Google Play/.test(String(and.subscriptionFaqAnswer())) && !/App Store/.test(String(and.subscriptionFaqAnswer())));
  ok('android plan row (store) → the Play Store page', /play\.google\.com/.test(String((and.planChangeRouteFor('store', 'pro') as { url: string }).url)));
  const web = load(src, OWNED[0].fns, OWNED[0].consts ?? [], 'web');
  ok('web FAQ subscription: unchanged (both stores + the help@ route)', /App Store or Google Play/.test(String(web.subscriptionFaqAnswer())) && /help@mageid\.app/.test(String(web.subscriptionFaqAnswer())));
  const webHand = web.planChangeRouteFor('manual', 'business') as { url: string; label: string };
  ok('web plan row, paid by hand: unchanged ("Your plan was turned on by MAGE ID", mailto)', webHand.label === 'Your plan was turned on by MAGE ID' && /^mailto:help@mageid\.app/.test(webHand.url));
  ok('web FAQ iPad: unchanged', web.ipadFaqAnswer() === 'Not yet. MAGE ID runs on iPhone, Android phones and the web app at app.mageid.app.');
  const pushWeb = load(stripComments(read(OWNED[2].file)), OWNED[2].fns, [], 'web');
  ok('web "How push works": unchanged', String(pushWeb.pushHowItWorks()).startsWith('Your iPhone or Android device registers when you sign in.'));
}

console.log('\n── 4. no "Priority queue" in Settings at all ──');
ok('Settings no longer sells a priority queue', !NEVER_ANYWHERE.test(read('app/(tabs)/settings/index.tsx')));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
