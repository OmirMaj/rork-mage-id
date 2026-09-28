// scripts/validate-growth-link.ts — the tracked "Built with MAGE ID" link (T6).
//
// Every page an outsider sees carries one small link back to mageid.app with
// ?ref=<page kind>. This guards the three things that make that safe and useful:
//
//   1. THE LINK. utils/growthLink.ts builds one exact URL per surface, and the
//      allow-list in it is the same list marketing/growth.js accepts.
//   2. NOTHING PERSONAL TRAVELS. A growth URL never carries a token, an email or
//      an id; the pay-link thank-you page reads nothing; and every growth link on
//      a page whose address carries a private token opens with no Referer
//      (rel="noopener noreferrer" + referrerpolicy="no-referrer" on static pages,
//      window.open(…, 'noopener,noreferrer') in the app), backed by
//      <meta name="referrer" content="no-referrer"> on the token pages.
//   3. THE COUNT. growth.js registers only allow-listed refs, never reads
//      document.referrer, carries the ref onto app.mageid.app links without
//      breaking ?plan=pro&trial=14, and the landing's PostHog init drops the
//      query string of any stored URL that carries t=, w= or a token.
//
// Surfaces whose file belongs to another lane are listed as "pending HANDOFF
// GROWTH-n" until their patch lands; once the file carries the link it is
// checked like every other. Set GROWTH_HANDOFF_DIR to also check the patches.
// GROWTH_ROOT points the whole run at a scratch copy (mutation testing).
//
// Run: bun run scripts/validate-growth-link.ts

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = process.env.GROWTH_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), '..');
const HANDOFF = process.env.GROWTH_HANDOFF_DIR ?? '';
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}

type GrowthMod = typeof import('../utils/growthLink');
const G = (await import(join(ROOT, 'utils/growthLink.ts'))) as GrowthMod;

const TAIL = '&utm_source=mageid&utm_medium=outsider_page&utm_campaign=built_with';
const urlFor = (s: string) => `https://mageid.app/?ref=${s}${TAIL}`;
const EXPECTED_SURFACES = ['portal', 'shared_estimate', 'shared_photos', 'pay_link', 'lien_waiver', 'bid_invite', 'sub_portal', 'prequal', 'builders', 'email'];

// ── 1. The link ──────────────────────────────────────────────────────────────
console.log('\nutils/growthLink.ts:');
ok('GROWTH_SURFACES is the approved list, in order', JSON.stringify(G.GROWTH_SURFACES) === JSON.stringify(EXPECTED_SURFACES),
  JSON.stringify(G.GROWTH_SURFACES));
for (const s of EXPECTED_SURFACES) {
  const got = G.growthLink(s as never);
  ok(`growthLink('${s}') is the exact URL`, got === urlFor(s), got);
}
ok('the link text is "Built with MAGE ID"', G.GROWTH_LINK_TEXT === 'Built with MAGE ID');

console.log('\nparseGrowthRef:');
const P = (v: unknown) => G.parseGrowthRef({ ref: v as string });
ok('accepts every allow-listed surface', EXPECTED_SURFACES.every((s) => P(s) === s));
ok('normalises case and spaces', P(' Bid_Invite ') === 'bid_invite');
ok('reads URLSearchParams', G.parseGrowthRef(new URLSearchParams('?plan=pro&ref=portal')) === 'portal');
ok('reads the first of a repeated param', G.parseGrowthRef({ ref: ['email', 'portal'] } as never) === 'email');
const REJECT = ['', 'twitter', 'portal2', 'portal?t=abc', 'portal&t=abc', 't=abc', 'a@b.com',
  '3f2b8c1e-9a4d-4c2b-8f1e-2a3b4c5d6e7f', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc', 'token', 'shared estimate', null, undefined, 42];
for (const v of REJECT) ok(`rejects ${JSON.stringify(v)}`, P(v) === null);
ok('no ref param → null', G.parseGrowthRef(new URLSearchParams('?plan=pro&trial=14')) === null);

// ── 2. growth.js: same list, safe decoration, never the referrer ────────────
console.log('\nmarketing/growth.js:');
const GROWTH_JS = read('marketing/growth.js');
ok('growth.js stays under 2 KB', Buffer.byteLength(GROWTH_JS) < 2048, `${Buffer.byteLength(GROWTH_JS)} bytes`);
const listLit = /var SURFACES = \[([^\]]*)\]/.exec(GROWTH_JS)?.[1] ?? '';
const jsList = [...listLit.matchAll(/'([^']*)'/g)].map((m) => m[1]);
ok('growth.js allow-list is identical to utils/growthLink.ts', JSON.stringify(jsList) === JSON.stringify([...G.GROWTH_SURFACES]),
  `growth.js: ${JSON.stringify(jsList)}`);
ok('growth.js is plain ES5 (no let/const/arrow/template)', !/\b(let|const)\s|=>|`/.test(GROWTH_JS));

interface FakeAnchor { tagName: string; href: string | null; getAttribute(n: string): string | null; setAttribute(n: string, v: string): void }
const fakeAnchor = (h: string | null): FakeAnchor => ({
  tagName: 'A',
  href: h,
  getAttribute(n: string) { return n === 'href' ? this.href : null; },
  setAttribute(n: string, v: string) { if (n === 'href') this.href = v; },
});
function runGrowth(opts: { search: string; session?: Record<string, string>; sessionThrows?: boolean; referrer?: string; hrefs: (string | null)[]; posthog?: boolean }) {
  const posthogCalls: string[] = [];
  const listeners: Record<string, ((e: unknown) => void)[]> = {};
  let referrerRead = false;
  const store: Record<string, string> = { ...(opts.session ?? {}) };
  const anchors: FakeAnchor[] = opts.hrefs.map(fakeAnchor);
  const sessionStorage = {
    getItem: (k: string) => { if (opts.sessionThrows) throw new Error('blocked'); return store[k] ?? null; },
    setItem: (k: string, v: string) => { if (opts.sessionThrows) throw new Error('blocked'); store[k] = v; },
  };
  const document = {
    getElementsByTagName: (t: string) => (t === 'a' ? anchors : []),
    get referrer() { referrerRead = true; return opts.referrer ?? ''; },
    addEventListener: (type: string, fn: (e: unknown) => void) => { (listeners[type] ??= []).push(fn); },
  };
  const window: Record<string, unknown> = { location: { search: opts.search }, sessionStorage, document };
  if (opts.posthog !== false) {
    window.posthog = new Proxy({}, {
      get: (_t, prop: string) => (...args: unknown[]) => { posthogCalls.push(`${prop}:${JSON.stringify(args)}`); },
    });
  }
  const ctx = vm.createContext({ window, document, decodeURIComponent, String, RegExp });
  vm.runInContext(GROWTH_JS, ctx);
  // a click on something inside an anchor, as the browser dispatches it
  const click = (target: unknown, type = 'click') => { for (const fn of listeners[type] ?? []) fn({ target }); };
  return { hrefs: anchors.map((a) => a.href), posthogCalls, store, referrerRead, click, listeners };
}

const HREFS = [
  'https://app.mageid.app/?plan=pro&trial=14',
  'https://app.mageid.app',
  'https://app.mageid.app/signup#top',
  'https://app.mageid.app/?ref=email',
  'https://mageid.app/pricing.html',
  'https://app.mageid.app.evil.example/',
  'https://evil.example/?next=https://app.mageid.app',
  '/pricing.html',
  null,
];
const r1 = runGrowth({ search: '?ref=bid_invite&utm_source=mageid', hrefs: HREFS, referrer: 'https://mageid.app/bid-invite/?t=abc123' });
ok('keeps ?plan=pro&trial=14 and adds ref', r1.hrefs[0] === 'https://app.mageid.app/?plan=pro&trial=14&ref=bid_invite', String(r1.hrefs[0]));
ok('a bare app link gets /?ref=', r1.hrefs[1] === 'https://app.mageid.app/?ref=bid_invite', String(r1.hrefs[1]));
ok('the #fragment stays last', r1.hrefs[2] === 'https://app.mageid.app/signup?ref=bid_invite#top', String(r1.hrefs[2]));
ok('an app link that already has a ref is left alone', r1.hrefs[3] === 'https://app.mageid.app/?ref=email');
ok('only app.mageid.app links are decorated (site, look-alike host, embedded URL, relative, none)',
  r1.hrefs.slice(4).every((h, i) => h === HREFS[4 + i]), JSON.stringify(r1.hrefs.slice(4)));
ok('registers growth_ref once with PostHog', r1.posthogCalls.length === 1 && r1.posthogCalls[0] === 'register_once:[{"growth_ref":"bid_invite"}]', r1.posthogCalls.join(' | '));
ok('keeps the ref for the session', r1.store.mageid_growth_ref === 'bid_invite');
ok('never reads document.referrer (a token page address can never reach PostHog from here)', !r1.referrerRead);
ok('nothing sent to PostHog carries the referrer token', !r1.posthogCalls.some((c) => /abc123|t=/.test(c)));

const r2 = runGrowth({ search: '?ref=3f2b8c1e-9a4d-4c2b-8f1e-2a3b4c5d6e7f', hrefs: [HREFS[0]] });
ok('an unknown ref registers nothing and decorates nothing', r2.posthogCalls.length === 0 && r2.hrefs[0] === HREFS[0] && !('mageid_growth_ref' in r2.store));
const r3 = runGrowth({ search: '', session: { mageid_growth_ref: 'portal' }, hrefs: [HREFS[0]] });
ok('a later page in the same session still carries the ref', r3.hrefs[0] === 'https://app.mageid.app/?plan=pro&trial=14&ref=portal', String(r3.hrefs[0]));
const r4 = runGrowth({ search: '', session: { mageid_growth_ref: 'evil@x.com' }, hrefs: [HREFS[0]] });
ok('a tampered session value is ignored', r4.hrefs[0] === HREFS[0] && r4.posthogCalls.length === 0);
const r5 = runGrowth({ search: '?ref=pay_link', sessionThrows: true, posthog: false, hrefs: [HREFS[1]] });
ok('blocked storage and no PostHog still decorate', r5.hrefs[0] === 'https://app.mageid.app/?ref=pay_link');
const r6 = runGrowth({ search: '', referrer: 'https://mageid.app/bid-invite/?t=abc123&ref=bid_invite', hrefs: [HREFS[0]] });
ok('document.referrer is read on no path (with a ref, without one, from session)',
  [r1, r2, r3, r4, r5, r6].every((r) => !r.referrerRead));
ok('a token page as the referrer registers and decorates nothing', r6.posthogCalls.length === 0 && r6.hrefs[0] === HREFS[0]);
// Links written after growth.js ran (the brain-demo "Try it free" cards) are
// fixed when they are clicked: the click lands on a span inside the anchor.
const late = fakeAnchor('https://app.mageid.app');
const lateSite = fakeAnchor('https://mageid.app/pricing.html');
r1.click({ tagName: 'SPAN', parentNode: late });
r1.click({ tagName: 'span', parentNode: lateSite }, 'auxclick');
ok('an app link written later gets the ref when clicked', late.href === 'https://app.mageid.app/?ref=bid_invite', String(late.href));
ok('…a middle-clicked site link is left alone', lateSite.href === 'https://mageid.app/pricing.html');
const lateLower = { ...fakeAnchor('https://app.mageid.app/signup'), tagName: 'a' }; // XHTML reports lower case
r1.click(lateLower, 'auxclick');
ok('…a middle-clicked app link gets it too, whatever the tag case', lateLower.href === 'https://app.mageid.app/signup?ref=bid_invite', String(lateLower.href));
r1.click({ tagName: 'DIV', parentNode: null });
ok('…a click outside any link does nothing (and does not throw)', true);
ok('with no ref, no click handler is added', Object.keys(r2.listeners).length === 0 && Object.keys(r6.listeners).length === 0);

// ── 3. The landing pages load it, and scrub token URLs from PostHog ─────────
console.log('\nlanding pages:');
for (const page of ['marketing/index.html', 'marketing/pricing.html']) {
  const n = (read(page).match(/<script src="\/growth\.js(\?v=[\w-]+)?" defer><\/script>/g) ?? []).length;
  ok(`${page} loads growth.js exactly once`, n === 1, `${n} tags`);
}
const home = read('marketing/index.html');
const bsSrc = /before_send:\s*(function \(e\) \{[\s\S]*?\n {6}\}),/.exec(home)?.[1] ?? '';
ok('the PostHog init has the before_send scrub', !!bsSrc);
if (bsSrc) {
  const bs = vm.runInNewContext(`(${bsSrc})`) as (e: unknown) => { properties: Record<string, string>; $set_once: Record<string, string> };
  const ev = bs({
    properties: { $referrer: 'https://mageid.app/bid-invite/?t=abc123', $current_url: 'https://mageid.app/?ref=bid_invite', $initial_referrer: 'https://www.google.com/search?q=gc+software' },
    $set_once: { $initial_referrer: 'https://mageid.app/lien-waiver/w1?w=9&t=abc', $initial_current_url: 'https://mageid.app/portal/x?token=zz' },
  });
  ok('a token referrer is stored without its query string', ev.properties.$referrer === 'https://mageid.app/bid-invite/', ev.properties.$referrer);
  ok('…and so are the initial referrer and initial URL', ev.$set_once.$initial_referrer === 'https://mageid.app/lien-waiver/w1' && ev.$set_once.$initial_current_url === 'https://mageid.app/portal/x');
  ok('a URL with no token is left exactly as it was', ev.properties.$current_url === 'https://mageid.app/?ref=bid_invite' && ev.properties.$initial_referrer === 'https://www.google.com/search?q=gc+software');
  ok('an event with no properties passes through', bs(null) === null);
}

// ── 4. Every outsider surface carries the link, with no Referer ──────────────
console.log('\noutsider surfaces:');
const HTML_LINK_OK = (tag: string) => {
  const rel = /\srel="([^"]*)"/.exec(tag)?.[1] ?? '';
  return /\bnoopener\b/.test(rel) && /\bnoreferrer\b/.test(rel) && /\sreferrerpolicy="no-referrer"/.test(tag) && /\starget="_blank"/.test(tag);
};
/** Every <a> whose href is a growth URL, and whether each one is safe. */
function htmlGrowthAnchors(src: string) {
  return [...src.matchAll(/<a\s[^>]*href="https:\/\/mageid\.app\/?\?ref=[^"]*"[^>]*>/g)].map((m) => m[0]);
}

interface Surface { surface: string; file: string; kind: 'html' | 'rn' | 'inapp' | 'email'; pending?: string }
const SURFACES: Surface[] = [
  { surface: 'shared_estimate', file: 'app/shared-estimate.tsx', kind: 'rn' },
  { surface: 'shared_photos', file: 'app/shared-photos.tsx', kind: 'rn' },
  { surface: 'prequal', file: 'app/prequal-form.tsx', kind: 'inapp' },
  { surface: 'email', file: 'utils/emailLayout.ts', kind: 'email' },
  { surface: 'bid_invite', file: 'marketing/bid-invite/index.html', kind: 'html' },
  { surface: 'sub_portal', file: 'marketing/sub-portal/index.html', kind: 'html' },
  { surface: 'builders', file: 'marketing/builders/index.html', kind: 'html' },
  { surface: 'pay_link', file: 'marketing/paid/index.html', kind: 'html' },
  // Remove `pending` once the patch has landed; the file is checked either way
  // as soon as it carries the link. GROWTH-3 and GROWTH-4 landed in the
  // integration onto main (2026-09-28), so a regression there now fails.
  { surface: 'portal', file: 'app/client-view.tsx', kind: 'rn', pending: 'GROWTH-2' },
  { surface: 'portal', file: 'marketing/portal/index.html', kind: 'html' },
  { surface: 'lien_waiver', file: 'marketing/lien-waiver/index.html', kind: 'html' },
];
ok('every allow-listed surface has at least one page', EXPECTED_SURFACES.every((s) => SURFACES.some((x) => x.surface === s)),
  EXPECTED_SURFACES.filter((s) => !SURFACES.some((x) => x.surface === s)).join(', '));

const ATTR = read('utils/growthAttribution.ts');
ok('openGrowthLink opens web links with noopener,noreferrer',
  /window\.open\(url, '_blank', 'noopener,noreferrer'\)/.test(ATTR) && /const url = growthLink\(surface\);/.test(ATTR));

const pendingNow: string[] = [];
for (const s of SURFACES) {
  const src = read(s.file);
  const label = `${s.file} (${s.surface})`;
  let has = false;
  if (s.kind === 'html') {
    const anchors = htmlGrowthAnchors(src);
    // A page still waiting on its patch may carry the older, untracked
    // `mageid.app?ref=…` link; it counts as pending until the exact URL lands.
    has = s.pending ? anchors.some((a) => a.includes(`href="${urlFor(s.surface)}"`)) : anchors.length > 0;
    if (has) {
      ok(`${label}: every growth link is the exact URL for its surface`, anchors.every((a) => a.includes(`href="${urlFor(s.surface)}"`)),
        anchors.filter((a) => !a.includes(urlFor(s.surface))).join(' | '));
      const bad = anchors.filter((a) => !HTML_LINK_OK(a));
      ok(`${label}: every growth link opens with no Referer (target _blank, rel noopener noreferrer, referrerpolicy no-referrer)`,
        bad.length === 0, `fails: ${bad.join(' | ')}`);
    }
  } else if (s.kind === 'rn') {
    has = src.includes(`openGrowthLink('${s.surface}')`);
    if (has) {
      ok(`${label}: no plain "Powered by MAGE ID" text is left beside it`, !/Powered by MAGE ID/.test(src));
      ok(`${label}: the link is not a raw href or Linking call (it would carry a Referer on web)`,
        !/href=\{?\s*growthLink|Linking\.openURL\(\s*growthLink|window\.open\(\s*growthLink/.test(src));
    }
  } else if (s.kind === 'inapp') {
    // The sub is already on app.mageid.app: sign-up stays in the app (no browser
    // navigation, so no Referer), and the ref is kept for user_signed_up.
    has = src.includes(`persistGrowthRef('${s.surface}')`);
    if (has) ok(`${label}: the ref is kept before the in-app sign-up route`, /void persistGrowthRef\('prequal'\);\s*router\.push\('\/signup'\);/.test(src));
  } else {
    has = src.includes(`growthLink('${s.surface}')`);
    if (has) ok(`${label}: the email footer uses it`, /const GROWTH_BADGE_URL = growthLink\('email'\);/.test(src) && !/\?ref=email`/.test(src));
  }
  if (!has && s.pending) { pendingNow.push(`${s.file} → pending HANDOFF ${s.pending}`); continue; }
  ok(`${label}: carries the growth link`, has);
}
for (const p of pendingNow) console.log(`  · ${p}`);

console.log('\ntoken pages send no Referer:');
for (const [file, pending] of [
  ['marketing/bid-invite/index.html', ''], ['marketing/sub-portal/index.html', ''],
  ['marketing/portal/index.html', ''], ['marketing/lien-waiver/index.html', ''],
  ['marketing/paid/index.html', ''],
] as const) {
  const src = read(file);
  const head = src.slice(0, src.indexOf('</head>'));
  const has = /<meta name="referrer" content="no-referrer" \/>/.test(head);
  if (!has && pending) { console.log(`  · ${file} → pending HANDOFF ${pending}`); continue; }
  ok(`${file} has <meta name="referrer" content="no-referrer"> in <head>`, has);
}

// ── 5. Nothing personal in any growth URL ────────────────────────────────────
console.log('\nno personal data in growth URLs:');
const SCAN = ['app', 'utils', 'components', 'marketing', 'supabase/functions'];
const found: string[] = [];
function walk(dir: string) {
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue;
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(rel);
    else if (/\.(tsx?|html|js)$/.test(e.name)) {
      for (const m of readFileSync(join(ROOT, rel), 'utf8').matchAll(/https:\/\/mageid\.app\/?\?ref=[^"'`\s<)]*/g)) found.push(`${rel}: ${m[0]}`);
    }
  }
}
for (const d of SCAN) if (existsSync(join(ROOT, d))) walk(d);
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const leaky = found.filter((f) => /token|@|\$\{|[?&](t|w|e|id|invoice|session)=/i.test(f.split(': ')[1]) || UUID.test(f));
ok(`no growth URL carries a token, an email, an id or an interpolated value (${found.length} found)`, leaky.length === 0, leaky.join(' | '));
const offList = found.filter((f) => { const ref = /\?ref=([a-z_]+)/.exec(f)?.[1]; return !ref || !EXPECTED_SURFACES.includes(ref); });
ok('every ref in a hard-coded growth URL is allow-listed', offList.length === 0, offList.join(' | '));

// ── 6. The pay link ends on the thank-you page, which reads nothing ─────────
console.log('\npay link:');
const paid = read('marketing/paid/index.html');
ok('marketing/paid/index.html is noindex', /<meta name="robots" content="noindex" \/>/.test(paid));
ok('…never names the Stripe session', !/CHECKOUT_SESSION_ID|session_id|cs_(live|test)_/i.test(paid));
ok('…loads no analytics and reads nothing from its address', !/posthog|location\.(search|href|hash)|URLSearchParams|document\.referrer/i.test(paid));
ok('…says what is true on every pay-link path (submitted to Stripe; the contractor sees it in MAGE ID once it clears — an AIA pay app with no invoice sends no notice)',
  /Payment submitted to Stripe/.test(paid) && /Your contractor sees this payment in MAGE ID once it clears\./.test(paid) && !/\bnotif(y|ied|ication)|gets a notice/i.test(paid) && !/!/.test(paid.replace(/<!--[\s\S]*?-->|<!doctype html>/gi, '')));
// Every pay link (an invoice or an AIA pay app) redirects here, so a receipt
// promise on this page is only true if the webhook emails one on BOTH paths.
// It does not today (handleAiaPayAppCompleted sends none), so the page must
// not promise one until it does.
const paidText = paid.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ');
const promisesReceipt = /receipt[^.]*\b(is|will be|gets?|are)\s+(e-?mailed|sent)|(emails?|sends?)\s+(you\s+)?(a|your)\s+receipt|receipt[^.]*\bemails you/i.test(paidText);
const hook = read('supabase/functions/stripe-webhook/index.ts');
const fnBody = (name: string) => { const i = hook.indexOf(`async function ${name}(`); if (i < 0) return ''; const j = hook.indexOf('\nasync function ', i + 1); return hook.slice(i, j < 0 ? undefined : j); };
const receiptOnBoth = ['handleCheckoutCompleted', 'handleAiaPayAppCompleted'].every((n) => /sendReceiptEmail\(/.test(fnBody(n)));
ok('…promises a receipt only if the webhook emails one for invoices AND AIA pay apps',
  !promisesReceipt || receiptOnBoth, `promises=${promisesReceipt} emailsOnBoth=${receiptOnBoth}`);
ok('…the receipt-promise check sees the webhook handlers', fnBody('handleCheckoutCompleted').length > 0 && fnBody('handleAiaPayAppCompleted').length > 0);
const cpl = read('supabase/functions/create-payment-link/index.ts');
const ac = cpl.split('\n').filter((l) => /^\s*after_completion:/.test(l));
ok('create-payment-link has exactly one live after_completion', ac.length === 1, ac.join(' | '));
ok('…and it is the redirect to https://mageid.app/paid/?ref=pay_link',
  ac[0]?.trim() === 'after_completion: { type: "redirect", redirect: { url: "https://mageid.app/paid/?ref=pay_link" } },', ac[0]);

// ── 7. Optional: the HANDOFF patches follow the same rules ──────────────────
if (HANDOFF) {
  console.log(`\nHANDOFF patches (${HANDOFF}):`);
  const patch = (n: string) => {
    const f = readdirSync(HANDOFF).find((x) => x.startsWith(`GROWTH-${n}-`) && x.endsWith('.patch'));
    return f ? readFileSync(join(HANDOFF, f), 'utf8') : '';
  };
  const added = (p: string) => p.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).join('\n');
  const p1 = added(patch('1'));
  ok('GROWTH-1 (_layout) captures the ref next to the ?plan= handoff', /captureGrowthRefFromLocation\(\);/.test(p1) && /from '@\/utils\/growthAttribution'/.test(p1));
  const p2 = added(patch('2'));
  ok('GROWTH-2 (client-view) opens the portal growth link through openGrowthLink', /openGrowthLink\('portal'\)/.test(p2) && !/Powered by MAGE ID/.test(p2));
  for (const [n, surface] of [['3', 'portal'], ['4', 'lien_waiver']] as const) {
    const p = added(patch(n));
    const anchors = htmlGrowthAnchors(p);
    ok(`GROWTH-${n} adds the ${surface} growth link`, anchors.length > 0 && anchors.every((a) => a.includes(urlFor(surface))));
    const bad = anchors.filter((a) => !HTML_LINK_OK(a));
    ok(`GROWTH-${n}: every growth link opens with no Referer`, anchors.length > 0 && bad.length === 0, bad.join(' | '));
    ok(`GROWTH-${n} adds <meta name="referrer" content="no-referrer">`, /<meta name="referrer" content="no-referrer" \/>/.test(p));
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
