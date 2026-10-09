// validate-manage-subscription.ts — Manage Subscription (lane WEBCANCEL, 2026-10-09).
//
// A person who subscribed on the web had no self-serve way to cancel: the app
// said to email help@mageid.app. RevenueCat's customer info carries a
// `managementURL` that no code read. This script holds the fix in place.
//
//   M1  Settings has ONE Manage Subscription row, in the plan section, and the
//       paywall offers the same row (both the phone and the web variant).
//   M2  The web path READS the management URL RevenueCat reports and opens it;
//       when it is null (or is not https) it falls back to the email, honestly.
//   M3  A plan bought in another store says where it is managed. An iPhone
//       build never names another phone platform and never gets an email or a
//       web link (App Store 2.3.10, 3.1.1).
//   M4  A Free account and a master account with no purchase get a plain line
//       ("no paid subscription on this account") and nothing to open.
//   M5  No code claims a cancellation, promises a time, or cancels anything.
//   M6  The renewal facts above each buy button name the platform's real path.
//   M7  After the customer comes back, the customer info is read again, and
//       the date shown is only the one RevenueCat reports.
//   M8  Sign Up shows the agreement sentence exactly once, above the buttons.
//   M9  English and Spanish for every string; the validator is in the chain.
//
// The pure module (utils/manageSubscription.ts) and renewalFactsText are
// sliced out of the real source, transpiled and RUN, so a planted mutation
// really executes. Every mutation below must turn its rule red.
//
// Run via: bun run scripts/validate-manage-subscription.ts

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

declare const Bun: {
  Transpiler: new (opts: { loader: 'ts' | 'tsx' }) => { transformSync(code: string): string };
};

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const F = {
  util: 'utils/manageSubscription.ts',
  hook: 'hooks/useManageSubscriptionCopy.ts',
  row: 'components/ManageSubscriptionRow.tsx',
  ctx: 'contexts/SubscriptionContext.tsx',
  settings: 'app/(tabs)/settings/index.tsx',
  paywall: 'app/paywall.tsx',
  onboarding: 'app/onboarding-paywall.tsx',
  modal: 'components/Paywall.tsx',
  signup: 'app/signup.tsx',
  en: 'i18n/catalog/en/office.manage-sub.generated.ts',
  es: 'i18n/catalog/es/office/manageSub.ts',
  pkg: 'package.json',
} as const;
type Files = Record<string, string>;

function stripComments(src: string): string {
  let out = '';
  let i = 0;
  let mode: 'code' | 'line' | 'block' | 'sq' | 'dq' | 'bt' = 'code';
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (mode === 'code') {
      if (c === '/' && n === '/') { mode = 'line'; i += 2; continue; }
      if (c === '/' && n === '*') { mode = 'block'; i += 2; continue; }
      if (c === "'") mode = 'sq'; else if (c === '"') mode = 'dq'; else if (c === '`') mode = 'bt';
      out += c; i++; continue;
    }
    if (mode === 'line') { if (c === '\n') { mode = 'code'; out += c; } i++; continue; }
    if (mode === 'block') { if (c === '*' && n === '/') { mode = 'code'; i += 2; continue; } if (c === '\n') out += c; i++; continue; }
    if (c === '\\') { out += c + (n ?? ''); i += 2; continue; }
    if ((mode === 'sq' && c === "'") || (mode === 'dq' && c === '"') || (mode === 'bt' && c === '`')) mode = 'code';
    out += c; i++;
  }
  return out;
}

const transpiler = new Bun.Transpiler({ loader: 'ts' });

interface Route { kind: string; url: string | null; selfServe: boolean }
interface Util {
  manageSubscriptionRoute: (i: { os: string; tier: string; store: string | null; managementURL: string | null; isOwner: boolean }) => Route;
  renewalFact: (i: { willRenew?: boolean | null; expirationDate?: string | null } | null) => { kind: string; iso: string } | null;
  safeManagementUrl: (raw: unknown) => string | null;
}

/** Run utils/manageSubscription.ts from source (it imports nothing). */
export function loadUtil(src: string): Util {
  const js = transpiler.transformSync(src).replace(/^export \{[^}]*\};?\s*$/gm, '').replace(/^export /gm, '');
  return new Function(`${js}\nreturn { manageSubscriptionRoute, renewalFact, safeManagementUrl };`)() as Util;
}

/** Run renewalFactsText from components/Paywall.tsx. */
function loadRenewalFacts(src: string): ((os: string, trialDays?: number) => string) | null {
  const m = /export function renewalFactsText\([\s\S]*?\n\}/.exec(src);
  if (!m) return null;
  const js = transpiler.transformSync(m[0].replace(/^export /, ''));
  return new Function(`${js}\nreturn renewalFactsText;`)() as (os: string, trialDays?: number) => string;
}

/** key → English, from the generated catalog. */
function catalog(src: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of src.matchAll(/^\s*"(office\.manageSub\.[A-Za-z.]+)": ("(?:[^"\\]|\\.)*")/gm)) out[m[1]] = JSON.parse(m[2]) as string;
  return out;
}
function esCatalog(src: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of src.matchAll(/^\s*"(office\.manageSub\.[A-Za-z.]+)": \{ s: ("(?:[^"\\]|\\.)*")/gm)) out[m[1]] = JSON.parse(m[2]) as string;
  return out;
}

/** The i18n keys the copy hook uses for one kind on one platform (read from the hook's own switch). */
export function keysForKind(hookSrc: string, kind: string, os: string): string[] {
  const code = stripComments(hookSrc);
  const at = code.indexOf(`case '${kind}':`);
  if (at < 0) return [];
  const rest = code.slice(at + 1);
  const next = rest.search(/\n\s*case '/);
  const end = rest.indexOf('\n    };');
  let block = rest.slice(0, next > -1 ? next : end > -1 ? end : rest.length);
  if (kind === 'store-here') {
    const colon = block.indexOf('\n            : {');
    if (colon > -1) block = os === 'ios' ? block.slice(0, colon) : block.slice(colon);
  }
  const keys = new Set<string>();
  for (const m of block.matchAll(/t\('(office\.manageSub\.[A-Za-z.]+)'/g)) keys.add(m[1]);
  // Shared sentences are held in a const above the switch.
  for (const m of code.matchAll(/const (\w+) = t\('(office\.manageSub\.[A-Za-z.]+)'/g)) {
    if (new RegExp(`\\b${m[1]}\\b`).test(block)) keys.add(m[2]);
  }
  return [...keys];
}

const OSES = ['ios', 'android', 'web'] as const;
const PAID = ['pro', 'business', 'enterprise'] as const;
const STORES: (string | null)[] = [null, 'APP_STORE', 'PLAY_STORE', 'RC_BILLING', 'STRIPE', 'PADDLE', 'PROMOTIONAL', 'UNKNOWN_STORE'];
const URLS: (string | null)[] = [null, '', 'https://billing.revenuecat.com/manage/abc', 'https://apps.apple.com/account/subscriptions', 'https://play.google.com/store/account/subscriptions?sku=x&package=app.mageid.android', 'http://insecure.example/manage', 'javascript:alert(1)'];
const PORTAL = 'https://billing.revenuecat.com/manage/abc';

/** Words that would claim more than the app does. English and Spanish. */
const CLAIMS_CANCELLED = /\b(has|have|had) been cancel|\b(was|were|is now|are now) cancel(l)?ed|\b(subscription|plan) cancel(l)?ed\b|\bwe(’ve|'ve| have)? cancel(l)?ed|successfully cancel|cancel(l)?ation (is |was )?(complete|confirmed|successful)|\bya (está|fue) cancelad|ha sido cancelad|se canceló|cancelad[oa] con éxito|cancelación (completa|confirmada)/i;
const PROMISES_TIME = /within (one|two|1|2|\d+) (business |working )?(day|hour)|business day|día(s)? hábil|en (un|\d+) día/i;
const PROMISES_REFUND = /\brefund|reembols/i;

type Rule = (f: Files) => string[];

const RULES: Record<string, Rule> = {
  'M1 one Manage Subscription row in Settings, and the same row on the paywall': (f) => {
    const bad: string[] = [];
    const s = stripComments(f[F.settings]);
    const rows = s.match(/<ManageSubscriptionRow\b[^>]*\/>/g) ?? [];
    if (rows.length !== 1) bad.push(`Settings draws the row ${rows.length} times (wanted exactly 1)`);
    const a = s.indexOf('<SettingsSection id="subscription">');
    const b = s.indexOf('<SettingsSection id="help">');
    const at = s.indexOf('<ManageSubscriptionRow');
    if (a < 0 || b < 0 || at < a || at > b) bad.push('the row is not inside the subscription section of Settings');
    if (rows[0] && /variant="paywall"/.test(rows[0])) bad.push('Settings uses the paywall variant, which hides the row on a Free account');
    if (/tier !== 'free' &&\s*<ManageSubscriptionRow/.test(s)) bad.push('Settings hides the row on a Free account');
    const p = stripComments(f[F.paywall]);
    const pr = p.match(/<ManageSubscriptionRow variant="paywall"[^>]*\/>/g) ?? [];
    if (pr.length !== 2) bad.push(`app/paywall.tsx offers the row ${pr.length} times (wanted 2: the phone screen and the web screen)`);
    if (catalog(f[F.en])['office.manageSub.label'] !== 'Manage Subscription') bad.push('the row is no longer labelled "Manage Subscription"');
    const row = stripComments(f[F.row]);
    if (!/if \(variant === 'paywall' && \(route\.kind === 'none' \|\| route\.kind === 'plan-line'\)\) return null;/.test(row)) bad.push('the paywall variant no longer hides itself on an account with no paid plan');
    return bad;
  },

  'M2 the web path reads the management URL and falls back honestly when it is null': (f) => {
    const bad: string[] = [];
    const ctx = stripComments(f[F.ctx]);
    if (!/const managementURL: string \| null = customerInfoQuery\.data\?\.managementURL \?\? null;/.test(ctx)) bad.push('the context does not read managementURL from the customer info');
    if (!/\n\s+managementURL,\n/.test(ctx)) bad.push('the context does not hand managementURL to the screens');
    const row = stripComments(f[F.row]);
    if (!/const managementURL = sub\.managementURL \?\? null;/.test(row)) bad.push('the row does not read managementURL from the context');
    if (!/manageSubscriptionRoute\(\{ os: Platform\.OS, tier, store, managementURL, isOwner: owner \}\)/.test(row)) bad.push('the row does not pass the management URL to the route');
    if (!/Linking\.openURL\(url\)\.catch\(\(\) => \{[\s\S]{0,120}showAlert\(lines\.label, lines\.fallback\)/.test(row)) bad.push('a page that fails to open no longer shows the fallback words');
    let u: Util;
    try { u = loadUtil(f[F.util]); } catch (e) { return [`utils/manageSubscription.ts does not run: ${(e as Error).message}`]; }
    for (const tier of PAID) for (const store of ['RC_BILLING', 'STRIPE', 'PADDLE']) {
      const withUrl = u.manageSubscriptionRoute({ os: 'web', tier, store, managementURL: PORTAL, isOwner: false });
      if (withUrl.kind !== 'web-portal' || withUrl.url !== PORTAL || withUrl.selfServe !== true) bad.push(`web, ${store}, ${tier}, URL reported: got ${JSON.stringify(withUrl)} (wanted the reported URL)`);
      for (const none of [null, '', '   ', 'http://insecure.example/manage', 'javascript:alert(1)', 'mailto:x@y.z']) {
        const r = u.manageSubscriptionRoute({ os: 'web', tier, store, managementURL: none, isOwner: false });
        if (r.kind !== 'email' || !/^mailto:help@mageid\.app/.test(r.url ?? '') || r.selfServe !== false) bad.push(`web, ${store}, ${tier}, URL ${JSON.stringify(none)}: got ${JSON.stringify(r)} (wanted the email fallback)`);
      }
    }
    // A plan from the server row with a web subscription RevenueCat knows about still gets its page.
    const viaRow = u.manageSubscriptionRoute({ os: 'web', tier: 'business', store: null, managementURL: PORTAL, isOwner: false });
    if (viaRow.kind !== 'web-portal' || viaRow.url !== PORTAL) bad.push('web, no entitlement for the tier but a URL reported: the URL is not used');
    const byHand = u.manageSubscriptionRoute({ os: 'web', tier: 'business', store: null, managementURL: null, isOwner: false });
    if (byHand.kind !== 'by-hand' || !/^mailto:help@mageid\.app/.test(byHand.url ?? '')) bad.push('web, a plan MAGE ID turned on: no email route');
    for (const [raw, want] of [[PORTAL, PORTAL], [` ${PORTAL} `, PORTAL], [null, null], [undefined, null], [42, null], ['', null], ['https://', null], ['http://a.b/c', null], ['itms-apps://apps.apple.com/x', null]] as [unknown, string | null][]) {
      if (u.safeManagementUrl(raw) !== want) bad.push(`safeManagementUrl(${JSON.stringify(raw)}) = ${JSON.stringify(u.safeManagementUrl(raw))} (wanted ${JSON.stringify(want)})`);
    }
    const en = catalog(f[F.en]);
    for (const [kind, key] of [['email', 'office.manageSub.email.body'], ['by-hand', 'office.manageSub.byHand.body']]) {
      if (!keysForKind(f[F.hook], kind, 'web').includes(key)) bad.push(`the ${kind} row no longer shows ${key}`);
      if (!/help@mageid\.app/.test(en[key] ?? '')) bad.push(`the ${kind} fallback no longer names help@mageid.app`);
    }
    const portal = keysForKind(f[F.hook], 'web-portal', 'web').map((k) => en[k] ?? '');
    if (!portal.some((t) => /billing page/.test(t))) bad.push('the web row no longer says it opens the billing page');
    return bad;
  },

  'M3 a plan bought in another store says where it is managed; the iPhone names no other platform': (f) => {
    const bad: string[] = [];
    let u: Util;
    try { u = loadUtil(f[F.util]); } catch (e) { return [`utils/manageSubscription.ts does not run: ${(e as Error).message}`]; }
    const en = catalog(f[F.en]);
    const r = (os: string, store: string | null, managementURL: string | null = null) => u.manageSubscriptionRoute({ os, tier: 'pro', store, managementURL, isOwner: false });
    const apple = r('web', 'APP_STORE');
    if (apple.kind !== 'other-apple' || apple.url !== 'https://apps.apple.com/account/subscriptions') bad.push(`web, App Store plan: got ${JSON.stringify(apple)}`);
    const google = r('web', 'PLAY_STORE');
    if (google.kind !== 'other-google' || !/^https:\/\/play\.google\.com\/store\/account\/subscriptions/.test(google.url ?? '')) bad.push(`web, Google Play plan: got ${JSON.stringify(google)}`);
    if (r('web', 'APP_STORE', PORTAL).url !== 'https://apps.apple.com/account/subscriptions') bad.push('web, App Store plan: a non-Apple URL was opened for it');
    const iosStore = r('ios', 'APP_STORE');
    if (iosStore.kind !== 'store-here' || iosStore.url !== 'itms-apps://apps.apple.com/account/subscriptions') bad.push(`iPhone, App Store plan: got ${JSON.stringify(iosStore)}`);
    const andStore = r('android', 'PLAY_STORE');
    if (andStore.kind !== 'store-here' || !/^https:\/\/play\.google\.com\//.test(andStore.url ?? '')) bad.push(`Android, Google Play plan: got ${JSON.stringify(andStore)}`);
    if (r('ios', 'RC_BILLING', PORTAL).kind !== 'elsewhere-web' || r('android', 'STRIPE', PORTAL).kind !== 'elsewhere-web') bad.push('a phone does not say a web plan is managed in the web app');
    const said = (kind: string, os: string, re: RegExp) => keysForKind(f[F.hook], kind, os).some((k) => re.test(en[k] ?? ''));
    if (!said('other-apple', 'web', /^You subscribed on iPhone\. Manage it in your Apple account settings\.$/)) bad.push('the App Store sentence is gone ("You subscribed on iPhone. Manage it in your Apple account settings.")');
    if (!said('other-google', 'web', /^You subscribed on Android\. Manage it in your Google Play subscriptions\.$/)) bad.push('the Google Play sentence is gone');
    if (!said('elsewhere-web', 'ios', /^You subscribed in the web app\./)) bad.push('the "You subscribed in the web app" sentence is gone');
    // Every state an iPhone can be in.
    const iosKinds = new Set<string>();
    for (const tier of ['free', ...PAID]) for (const store of STORES) for (const url of URLS) for (const isOwner of [false, true]) {
      const x = u.manageSubscriptionRoute({ os: 'ios', tier, store, managementURL: url, isOwner });
      iosKinds.add(x.kind);
      if (x.url !== null && x.url !== 'itms-apps://apps.apple.com/account/subscriptions') bad.push(`iPhone (${tier}, ${store}, owner ${isOwner}) opens ${x.url}`);
    }
    const allowed = ['none', 'store-here', 'elsewhere-web', 'elsewhere', 'plan-line'];
    for (const k of iosKinds) if (!allowed.includes(k)) bad.push(`an iPhone reaches the "${k}" state`);
    const iosBanned = /Android|Google Play|Play Store|play\.google|help@mageid|mailto|\bemail\b|turned on by MAGE ID/i;
    for (const k of iosKinds) for (const key of keysForKind(f[F.hook], k, 'ios')) {
      if (iosBanned.test(en[key] ?? '')) bad.push(`iPhone text ${key} says "${en[key]}"`);
    }
    return bad;
  },

  'M4 a Free account and a master account get a plain line and no link': (f) => {
    const bad: string[] = [];
    let u: Util;
    try { u = loadUtil(f[F.util]); } catch (e) { return [`utils/manageSubscription.ts does not run: ${(e as Error).message}`]; }
    for (const os of OSES) {
      for (const store of STORES) for (const url of URLS) {
        const free = u.manageSubscriptionRoute({ os, tier: 'free', store, managementURL: url, isOwner: false });
        if (free.kind !== 'none' || free.url !== null || free.selfServe) bad.push(`${os}, Free (${store}, ${url}): got ${JSON.stringify(free)}`);
      }
      const owner = u.manageSubscriptionRoute({ os, tier: 'business', store: null, managementURL: null, isOwner: true });
      if (owner.kind !== 'none' || owner.url !== null) bad.push(`${os}, master account with no purchase: got ${JSON.stringify(owner)}`);
    }
    const ownerPaid = u.manageSubscriptionRoute({ os: 'ios', tier: 'business', store: 'APP_STORE', managementURL: null, isOwner: true });
    if (ownerPaid.kind !== 'store-here') bad.push('a master account that really bought a plan cannot manage it');
    const en = catalog(f[F.en]);
    if (en['office.manageSub.none.body'] !== 'There is no paid subscription on this account.') bad.push('the no-subscription line changed');
    const row = stripComments(f[F.row]);
    if (!/if \(!route\.url\) \{[\s\S]{0,400}?<View style=\{styles\.row\} testID=\{`\$\{testID\}-line`\}>/.test(row)) bad.push('a row with nothing to open is no longer a plain line');
    if (!/isOwner\(user\?\.email\)/.test(row)) bad.push('the row does not ask utils/owner whether this is a master account');
    return bad;
  },

  'M5 no code claims a cancellation, promises a time, or cancels anything': (f) => {
    const bad: string[] = [];
    const en = catalog(f[F.en]);
    const es = esCatalog(f[F.es]);
    const facts = loadRenewalFacts(f[F.modal]);
    const texts: [string, string][] = [
      ...Object.entries(en).map(([k, v]) => [`en ${k}`, v] as [string, string]),
      ...Object.entries(es).map(([k, v]) => [`es ${k}`, v] as [string, string]),
      ...OSES.map((os) => [`renewal facts (${os})`, facts ? facts(os, 14) : ''] as [string, string]),
    ];
    for (const [where, text] of texts) {
      if (CLAIMS_CANCELLED.test(text)) bad.push(`${where} claims a cancellation: "${text}"`);
      if (PROMISES_TIME.test(text)) bad.push(`${where} promises a time the Terms do not: "${text}"`);
      if (PROMISES_REFUND.test(text)) bad.push(`${where} speaks of a refund: "${text}"`);
      if (/unlimited|ilimitad/i.test(text)) bad.push(`${where} says "unlimited"`);
      if (/[—→]|&|\be\.g\./.test(text)) bad.push(`${where} breaks the house style: "${text}"`);
    }
    for (const file of [F.hook, F.row, F.util]) {
      const code = stripComments(f[file]);
      const lit = (code.match(/'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g) ?? []).join('\n');
      if (CLAIMS_CANCELLED.test(lit)) bad.push(`${file} holds a string that claims a cancellation`);
      if (PROMISES_TIME.test(lit)) bad.push(`${file} holds a string that promises a time`);
    }
    const row = stripComments(f[F.row]);
    if (/\bPurchases\b/.test(row)) bad.push('the row reaches into the RevenueCat SDK itself');
    for (const file of [F.row, F.ctx, F.util, F.hook]) {
      if (/\b(cancelSubscription|cancelPlan|cancelEntitlement|revokeEntitlement)\b/.test(stripComments(f[file]))) bad.push(`${file} cancels a plan itself`);
    }
    return bad;
  },

  'M6 the renewal facts above each buy button name the platform’s real path': (f) => {
    const bad: string[] = [];
    const facts = loadRenewalFacts(f[F.modal]);
    if (!facts) return ['components/Paywall.tsx: renewalFactsText is gone'];
    const web = facts('web');
    if (!/You can cancel any time from Settings, Manage Subscription\./.test(web)) bad.push(`the web sentence does not name the Settings row: "${web}"`);
    if (!/If no billing page opens there, email help@mageid\.app\.$/.test(web)) bad.push('the web sentence lost its fallback (the email)');
    if (/To cancel, email help@mageid\.app before the renewal date/.test(web)) bad.push('the web sentence is the old email-only one');
    const ios = facts('ios');
    if (!/To cancel, open your App Store account settings/.test(ios) || /help@mageid|Google Play|Android/.test(ios)) bad.push(`the iPhone sentence is wrong: "${ios}"`);
    const and = facts('android');
    if (!/To cancel, open your Google Play account settings/.test(and) || /help@mageid|App Store/.test(and)) bad.push(`the Android sentence is wrong: "${and}"`);
    for (const os of OSES) if (!/renews automatically at that price until you cancel/.test(facts(os))) bad.push(`${os}: the sentence no longer says it renews`);
    const screens: [string, string, string][] = [
      [F.paywall, 'testID="paywall-renewal-facts"', 'testID="buy-pro"'],
      [F.onboarding, 'testID="onboarding-paywall-renewal-facts"', 'testID="onboarding-paywall-cta"'],
      [F.modal, 'testID="paywall-modal-renewal-facts"', 'testID="paywall-upgrade-btn"'],
    ];
    for (const [file, factsId, button] of screens) {
      const code = stripComments(f[file]);
      const a = code.indexOf(factsId), b = code.indexOf(button);
      if (a < 0 || b < 0 || b < a) bad.push(`${file}: the renewal facts are not above the buy button`);
      const line = code.slice(Math.max(0, a - 80), a + 200);
      if (!/renewalFactsText\(Platform\.OS/.test(line)) bad.push(`${file}: the facts are not renewalFactsText(Platform.OS)`);
    }
    if (!/renewalFactsText\('web'\)/.test(stripComments(f[F.paywall]))) bad.push('app/paywall.tsx: the web plans screen no longer prints the web facts');
    // The path the sentence names has to exist: the web row is self-serve when a URL is reported.
    try {
      const u = loadUtil(f[F.util]);
      if (!u.manageSubscriptionRoute({ os: 'web', tier: 'pro', store: 'RC_BILLING', managementURL: PORTAL, isOwner: false }).selfServe) bad.push('the web sentence names a self-serve row that does not exist');
    } catch (e) { bad.push(`utils/manageSubscription.ts does not run: ${(e as Error).message}`); }
    return bad;
  },

  'M7 the plan is read again on return, and the only date shown is the one RevenueCat reports': (f) => {
    const bad: string[] = [];
    const row = stripComments(f[F.row]);
    if (!/AppState\.addEventListener\('change', \(state\) => \{\s*if \(state === 'active' && awaitingReturn\.current\) refresh\(\);/.test(row)) bad.push('the row does not read the plan again when the customer comes back');
    if (!/awaitingReturn\.current = true;\s*Linking\.openURL\(url\)/.test(row)) bad.push('the row does not mark that it sent the customer out');
    if (!/void refreshCustomerInfo\(\)/.test(row)) bad.push('refresh does not call refreshCustomerInfo');
    if (!/if \(await showStoreManageSheet\(\)\) \{ refresh\(\); return; \}/.test(row)) bad.push('closing Apple’s sheet does not read the plan again');
    const ctx = stripComments(f[F.ctx]);
    const m = /const refreshCustomerInfo = useCallback\(async \(\): Promise<void> => \{[\s\S]*?\n {2}\}, \[/.exec(ctx);
    if (!m || !/invalidateQueries\(\{ queryKey: \['rc-customer-info'\] \}\)/.test(m[0])) bad.push('refreshCustomerInfo does not re-read the customer info');
    const sheet = /const showStoreManageSheet = useCallback\(async \(\): Promise<boolean> => \{[\s\S]*?\n {2}\}, \[/.exec(ctx);
    if (!sheet || !/if \(!rcConfigured \|\| Platform\.OS !== 'ios'\) return false;/.test(sheet[0]) || !/catch/.test(sheet[0])) bad.push('showStoreManageSheet is not iPhone-only with a fallback');
    if (!/return \{ willRenew: e\.willRenew, expirationDate: e\.expirationDate \?\? null \};/.test(ctx)) bad.push('planRenewal is not what the entitlement reports');
    let u: Util;
    try { u = loadUtil(f[F.util]); } catch (e) { return [...bad, `utils/manageSubscription.ts does not run: ${(e as Error).message}`]; }
    const iso = '2026-11-09T12:00:00Z';
    const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
    if (!same(u.renewalFact({ willRenew: true, expirationDate: iso }), { kind: 'renews', iso })) bad.push('a renewing plan is not "renews"');
    if (!same(u.renewalFact({ willRenew: false, expirationDate: iso }), { kind: 'ends', iso })) bad.push('a plan that will not renew is not "ends"');
    for (const none of [null, { willRenew: true, expirationDate: null }, { willRenew: true }, { willRenew: true, expirationDate: '' }, { willRenew: true, expirationDate: 'soon' }, { expirationDate: iso }, { willRenew: null, expirationDate: iso }]) {
      if (u.renewalFact(none) !== null) bad.push(`a date is printed for ${JSON.stringify(none)}`);
    }
    const en = catalog(f[F.en]);
    if (en['office.manageSub.renewsOn'] !== 'Renews on {date}' || en['office.manageSub.endsOn'] !== 'Ends on {date}') bad.push('the date line is no longer "Renews on" / "Ends on"');
    if (!/const renewalLine = route\.kind === 'none' \? null : copy\.renewal\(renewalFact\(sub\.planRenewal \?\? null\)\);/.test(row)) bad.push('the row prints a date that did not come from RevenueCat, or prints one with no plan');
    return bad;
  },

  'M8 Sign Up shows the agreement sentence exactly once, above the buttons': (f) => {
    const bad: string[] = [];
    const s = stripComments(f[F.signup]);
    const notices = s.match(/<AgreementNotice\b/g) ?? [];
    if (notices.length !== 1) bad.push(`app/signup.tsx draws <AgreementNotice /> ${notices.length} times`);
    if (/By creating an account you agree|agree to (our|the) /i.test(s)) bad.push('app/signup.tsx types the agreement sentence a second time');
    if (/testID="signup-terms-link"|testID="signup-privacy-link"/.test(s)) bad.push('the older Terms and Privacy links under Create Account are back');
    const at = s.indexOf('<AgreementNotice testID="signup-agreement"');
    if (at < 0) bad.push('the shared notice is not signup-agreement');
    for (const button of ['testID="signup-apple-top"', 'testID="signup-google-top"', 'testID="signup-submit"']) {
      const b = s.indexOf(button);
      if (b < 0) bad.push(`app/signup.tsx: cannot find ${button}`);
      else if (at < 0 || b < at) bad.push(`the agreement sentence is below ${button}`);
    }
    return bad;
  },

  'M9 English and Spanish for every string, and this validator is in the chain': (f) => {
    const bad: string[] = [];
    const en = catalog(f[F.en]);
    const es = esCatalog(f[F.es]);
    const hookKeys = new Set([...stripComments(f[F.hook]).matchAll(/t\('(office\.manageSub\.[A-Za-z.]+)'/g)].map((m) => m[1]));
    if (hookKeys.size < 30) bad.push(`the copy hook holds ${hookKeys.size} keys`);
    for (const k of hookKeys) {
      if (!en[k]) bad.push(`no English for ${k}`);
      if (!es[k]) bad.push(`no Spanish for ${k}`);
      else if (es[k] === en[k] && !/^\{/.test(en[k])) bad.push(`the Spanish for ${k} is the English`);
      for (const v of (en[k] ?? '').match(/\{\w+\}/g) ?? []) if (es[k] && !es[k].includes(v)) bad.push(`the Spanish for ${k} lost ${v}`);
    }
    if (/\bt\('|useT\(/.test(stripComments(f[F.row]))) bad.push('the row holds its own strings (they belong in the copy hook)');
    const pkg = JSON.parse(f[F.pkg]) as { scripts: Record<string, string> };
    if (pkg.scripts['test:manage-subscription'] !== 'bun run scripts/validate-manage-subscription.ts') bad.push('package.json: test:manage-subscription is missing');
    if (!/&& bun run test:manage-subscription(\s|&|$)/.test(pkg.scripts['ship-check'] ?? '')) bad.push('package.json: test:manage-subscription is not in the ship-check chain');
    return bad;
  },
};

if (import.meta.main) {
  const FILES: Files = {};
  for (const rel of Object.values(F)) FILES[rel] = readFileSync(path.join(ROOT, rel), 'utf8');

  let pass = 0, fail = 0;
  const ok = (name: string, cond: boolean, detail = '') => {
    if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`); }
  };

  console.log('\nvalidate-manage-subscription\n');
  for (const [name, rule] of Object.entries(RULES)) {
    const bad = rule(FILES);
    ok(name, bad.length === 0, bad.join('\n      '));
  }

  const sub = (f: Files, file: string, from: string, to: string) => {
    if (!f[file].includes(from)) throw new Error(`${file}: cannot find ${JSON.stringify(from.slice(0, 70))}`);
    f[file] = f[file].replace(from, to);
  };
  const R = Object.keys(RULES);
  const rule = (id: string) => { const r = R.find((k) => k.startsWith(`${id} `)); if (!r) throw new Error(`no rule ${id}`); return r; };

  const MUTATIONS: { what: string; rule: string; edit: (f: Files) => void }[] = [
    { what: 'Settings loses the row', rule: rule('M1'), edit: (f) => sub(f, F.settings, '<ManageSubscriptionRow testID="manage-subscription" />', '') },
    { what: 'Settings hides the row on a Free account', rule: rule('M1'), edit: (f) => sub(f, F.settings, '<ManageSubscriptionRow testID="manage-subscription" />', '<ManageSubscriptionRow variant="paywall" testID="manage-subscription" />') },
    { what: 'Settings draws the row twice', rule: rule('M1'), edit: (f) => sub(f, F.settings, '<ManageSubscriptionRow testID="manage-subscription" />', '<ManageSubscriptionRow testID="manage-subscription" /><ManageSubscriptionRow testID="manage-subscription-2" />') },
    { what: 'the web plans screen loses the row', rule: rule('M1'), edit: (f) => { const i = f[F.paywall].lastIndexOf('<ManageSubscriptionRow variant="paywall"'); f[F.paywall] = `${f[F.paywall].slice(0, i)}<Hidden${f[F.paywall].slice(i + 22)}`; } },
    { what: 'the row is renamed', rule: rule('M1'), edit: (f) => sub(f, F.en, '"office.manageSub.label": "Manage Subscription"', '"office.manageSub.label": "Billing"') },
    { what: 'the context stops reading managementURL', rule: rule('M2'), edit: (f) => sub(f, F.ctx, 'customerInfoQuery.data?.managementURL ?? null', 'null') },
    { what: 'the row stops passing the management URL', rule: rule('M2'), edit: (f) => sub(f, F.row, 'tier, store, managementURL, isOwner: owner }', 'tier, store, managementURL: null, isOwner: owner }') },
    { what: 'the web route ignores the reported URL', rule: rule('M2'), edit: (f) => sub(f, F.util, "if (reported && !isAppleHost(host) && !isGoogleHost(host)) return { kind: 'web-portal', url: reported, selfServe: true };", '') },
    { what: 'a null URL becomes a dead link', rule: rule('M2'), edit: (f) => sub(f, F.util, "return { kind: 'email', url: SUPPORT_MAILTO, selfServe: false };", "return { kind: 'web-portal', url: null, selfServe: true };") },
    { what: 'a URL that is not https is opened', rule: rule('M2'), edit: (f) => sub(f, F.util, 'return /^https:\\/\\/[^\\s/]+\\.[^\\s/]+/i.test(url) ? url : null;', 'return url || null;') },
    { what: 'the email fallback loses its address', rule: rule('M2'), edit: (f) => sub(f, F.en, '"office.manageSub.email.body": "To change or cancel your plan, email help@mageid.app."', '"office.manageSub.email.body": "To change or cancel your plan, contact support."') },
    { what: 'a failed open shows nothing', rule: rule('M2'), edit: (f) => sub(f, F.row, 'showAlert(lines.label, lines.fallback);', '') },
    { what: 'an App Store subscriber on the web is sent to the email', rule: rule('M3'), edit: (f) => sub(f, F.util, "if (store === 'APP_STORE' || (!store && isAppleHost(host))) {", 'if (false) {') },
    { what: 'an iPhone with a hand-turned-on plan gets the email route', rule: rule('M3'), edit: (f) => sub(f, F.util, "    if (store === 'PLAY_STORE') return plain('elsewhere');\n    return plain('plan-line');", "    if (store === 'PLAY_STORE') return plain('elsewhere');\n    return { kind: 'by-hand', url: SUPPORT_MAILTO, selfServe: false };") },
    { what: 'an iPhone opens the web billing page', rule: rule('M3'), edit: (f) => sub(f, F.util, "    if (store && WEB_STORES.includes(store)) return plain('elsewhere-web');\n    if (store === 'PLAY_STORE') return plain('elsewhere');", "    if (store && WEB_STORES.includes(store)) return { kind: 'web-portal', url: reported, selfServe: true };\n    if (store === 'PLAY_STORE') return plain('elsewhere');") },
    { what: 'the iPhone text names Android', rule: rule('M3'), edit: (f) => sub(f, F.en, '"office.manageSub.elsewhere.body": "This plan was not bought on this phone.', '"office.manageSub.elsewhere.body": "This plan was bought on Android.') },
    { what: 'the App Store sentence is reworded into a promise', rule: rule('M3'), edit: (f) => sub(f, F.en, '"office.manageSub.apple.body": "You subscribed on iPhone. Manage it in your Apple account settings."', '"office.manageSub.apple.body": "We will handle it for you."') },
    { what: 'a Free account gets a link', rule: rule('M4'), edit: (f) => sub(f, F.util, "  if (tier === 'free') return plain('none');\n", '') },
    { what: 'a master account gets the email link', rule: rule('M4'), edit: (f) => sub(f, F.util, "  if (input.isOwner && !store && !reported) return plain('none');\n", '') },
    { what: 'the row stops asking whether this is a master account', rule: rule('M4'), edit: (f) => sub(f, F.row, 'const owner = isOwner(user?.email);', 'const owner = false;') },
    { what: 'the row says the plan was cancelled', rule: rule('M5'), edit: (f) => sub(f, F.en, 'Opens your billing page in a new tab, where you can change or cancel your plan.', 'Your subscription has been cancelled.') },
    { what: 'the hook says "we cancelled"', rule: rule('M5'), edit: (f) => sub(f, F.hook, "'The billing page did not open. To change or cancel your plan, email help@mageid.app.'", "'We cancelled your plan.'") },
    { what: 'the fallback promises one business day', rule: rule('M5'), edit: (f) => sub(f, F.en, '"office.manageSub.email.body": "To change or cancel your plan, email help@mageid.app."', '"office.manageSub.email.body": "To cancel, email help@mageid.app and we will cancel it within one business day."') },
    { what: 'the Spanish says it was cancelled', rule: rule('M5'), edit: (f) => sub(f, F.es, 'Esta cuenta no tiene una suscripción de pago.', 'Tu suscripción ha sido cancelada.') },
    { what: 'the row calls the RevenueCat SDK itself', rule: rule('M5'), edit: (f) => sub(f, F.row, 'if (await showStoreManageSheet()) { refresh(); return; }', 'if (await showStoreManageSheet()) { refresh(); void Purchases.logOut(); return; }') },
    { what: 'the web sentence goes back to email only', rule: rule('M6'), edit: (f) => sub(f, F.modal, "'You can cancel any time from Settings, Manage Subscription. If no billing page opens there, email help@mageid.app.'", "'To cancel, email help@mageid.app before the renewal date.'") },
    { what: 'the web sentence drops its fallback', rule: rule('M6'), edit: (f) => sub(f, F.modal, ' If no billing page opens there, email help@mageid.app.', '') },
    { what: 'the iPhone sentence sends him to an email', rule: rule('M6'), edit: (f) => sub(f, F.modal, "'To cancel, open your App Store account settings at least 24 hours before the renewal date.'", "'To cancel, email help@mageid.app.'") },
    { what: 'the onboarding paywall prints the web facts on a phone', rule: rule('M6'), edit: (f) => sub(f, F.onboarding, 'renewalFactsText(Platform.OS, intentTrialDays)', "renewalFactsText('web', intentTrialDays)") },
    { what: 'the web row is not self-serve but the sentence still names it', rule: rule('M6'), edit: (f) => sub(f, F.util, "return { kind: 'web-portal', url: reported, selfServe: true };", "return { kind: 'web-portal', url: reported, selfServe: false };") },
    { what: 'the row stops reading the plan again on return', rule: rule('M7'), edit: (f) => sub(f, F.row, "if (state === 'active' && awaitingReturn.current) refresh();", '') },
    { what: 'refreshCustomerInfo stops re-reading', rule: rule('M7'), edit: (f) => sub(f, F.ctx, "    await queryClient.invalidateQueries({ queryKey: ['rc-customer-info'] });\n    if (userId) void queryClient.invalidateQueries({ queryKey: ['subscription-supabase', userId] });\n  }, [queryClient, userId]);", '  }, [queryClient, userId]);') },
    { what: 'a date is invented when none is reported', rule: rule('M7'), edit: (f) => sub(f, F.util, "if (!input || typeof input.expirationDate !== 'string' || input.expirationDate === '') return null;", "if (!input) return null;\n  if (typeof input.expirationDate !== 'string' || input.expirationDate === '') return { kind: 'renews', iso: new Date().toISOString() };") },
    { what: 'a plan that will not renew is shown as renewing', rule: rule('M7'), edit: (f) => sub(f, F.util, "kind: input.willRenew ? 'renews' : 'ends'", "kind: 'renews'") },
    { what: '"Renews on" becomes a promise', rule: rule('M7'), edit: (f) => sub(f, F.en, '"office.manageSub.renewsOn": "Renews on {date}"', '"office.manageSub.renewsOn": "Guaranteed until {date}"') },
    { what: 'the manage sheet is tried on every platform', rule: rule('M7'), edit: (f) => sub(f, F.ctx, "if (!rcConfigured || Platform.OS !== 'ios') return false;", 'if (!rcConfigured) return false;') },
    { what: 'Sign Up types the sentence a second time', rule: rule('M8'), edit: (f) => sub(f, F.signup, '<View style={styles.loginRow}>', '<Text>By creating an account you agree to our Terms of Service and Privacy Policy.</Text><View style={styles.loginRow}>') },
    { what: 'Sign Up draws the notice twice', rule: rule('M8'), edit: (f) => sub(f, F.signup, '<View style={styles.loginRow}>', '<AgreementNotice testID="signup-agreement-2" /><View style={styles.loginRow}>') },
    { what: 'Sign Up loses the notice', rule: rule('M8'), edit: (f) => sub(f, F.signup, '<AgreementNotice testID="signup-agreement" style={{ marginBottom: 12 }} />', '') },
    { what: 'Sign Up moves the notice under Create Account', rule: rule('M8'), edit: (f) => { sub(f, F.signup, '<AgreementNotice testID="signup-agreement" style={{ marginBottom: 12 }} />', ''); sub(f, F.signup, '<View style={styles.loginRow}>', '<AgreementNotice testID="signup-agreement" /><View style={styles.loginRow}>'); } },
    { what: 'a Spanish line is dropped', rule: rule('M9'), edit: (f) => { f[F.es] = f[F.es].replace(/^\s*"office\.manageSub\.web\.body":.*\n/m, ''); } },
    { what: 'the row types its own string', rule: rule('M9'), edit: (f) => sub(f, F.row, 'const copy = useManageSubscriptionCopy();', "const copy = useManageSubscriptionCopy(); const { t } = useT(); void t('office.manageSub.x', 'x');") },
    { what: 'the validator is dropped from the chain', rule: rule('M9'), edit: (f) => sub(f, F.pkg, ' && bun run test:manage-subscription', '') },
  ];

  console.log('\nplanted mutations (in memory; each must turn its rule red)');
  for (const m of MUTATIONS) {
    const copy: Files = { ...FILES };
    let applied = true;
    try { m.edit(copy); } catch (e) { applied = false; ok(`mutation applies: ${m.what}`, false, (e as Error).message); }
    if (!applied) continue;
    let bad: string[] = [];
    try { bad = RULES[m.rule](copy); } catch (e) { bad = [(e as Error).message]; }
    ok(`red on: ${m.what}`, bad.length > 0);
  }

  console.log(`\n${fail === 0 ? '✓' : '✗'} validate-manage-subscription: ${pass} passed, ${fail} failed (${Object.keys(RULES).length} rules, ${MUTATIONS.length} planted mutations)\n`);
  process.exit(fail === 0 ? 0 : 1);
}
