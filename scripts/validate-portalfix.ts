// scripts/validate-portalfix.ts — lane PORTALFIX (2026-10-03): the client
// portal's access and honesty fixes. Three real client links are live, so each
// property below is a way a homeowner's key leaks, a homeowner gets locked out,
// or the page or an invite says something the system does not do.
//
//   1. SHARE LEAK. The client page's "Share this portal" button shared
//      location.href, which carries ?t= — the key that opens the money, the
//      contract and change-order signing AS the client. It now shares the plain
//      public MAGE ID link. No other control on the page reads the address to
//      hand it on, and a print (the browser prints the address in its footer)
//      takes the key out of the address bar for its length.
//   2. RESET LINK. The GC can cut off a leaked link: "Reset link" calls the live
//      owner-only RPC portal_rotate_access_token, confirms first, refuses
//      offline (never queued — it changes who can open the portal), adopts the
//      fresh key and offers to send the new link.
//   3. PASSCODE LOCKOUT. The client's passcode box took 4 digits on a number
//      pad; the GC can set 4 to 20 characters with letters. Both sides now read
//      the same rule (PORTAL_PASSCODE_MIN_LENGTH / _MAX_LENGTH).
//   4. FALSE STATEMENTS. No "Your contractor was notified." for an event the
//      notify function refuses from the page; no dead notify calls; the invite
//      fallback says a passcode exists when one is set (never the code itself);
//      invites list only the sections switched on; no "within seconds".
//   5. SAMPLE GUARD. utils/sampleGuard.ts promises "no client-portal post", so
//      a Sample project can't save, share, publish or reset a portal.
//
// HOW IT CHECKS. The page is static HTML and the screen imports react-native,
// so most checks read COMMENT-STRIPPED source; the page's own key helpers are
// lifted and executed in a vm, and the pure invite/passcode helpers in
// utils/portalSnapshot.ts are imported and run.
//
// Run: bun run scripts/validate-portalfix.ts
// Mutation-tested 2026-10-03 (see the lane handoff): every mutation listed there turns its check red.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// PFX_ROOT points the SOURCE reads at a scratch copy (mutation testing); the
// pure modules are always imported from the repo.
const TEXT_ROOT = process.env.PFX_ROOT ?? ROOT;
const read = (rel: string): string => { try { return readFileSync(join(TEXT_ROOT, rel), 'utf8'); } catch { return ''; } };

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}

/** Strip // and /* *\/ comments (keeps `https://` inside strings). */
function stripJs(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\'"])\/\/.*$/gm, '$1');
}
/** Strip <!-- --> comments. */
const stripHtml = (src: string) => src.replace(/<!--[\s\S]*?-->/g, '');

/** Index of the brace that closes the one at `open`. */
function matchBrace(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return i; }
  }
  return -1;
}
/** The full text of `function name(...) { ... }` in `src`, or ''. */
function liftFunction(src: string, name: string): string {
  const at = src.search(new RegExp(`function ${name}\\s*\\(`));
  if (at < 0) return '';
  const open = src.indexOf('{', at);
  const close = matchBrace(src, open);
  return close < 0 ? '' : src.slice(at, close + 1);
}
/** The body of `const name = useCallback(...)` in `src`, up to its closing `}, [`. */
function liftCallback(src: string, name: string): string {
  const at = src.search(new RegExp(`const ${name}\\s*=\\s*useCallback\\(`));
  if (at < 0) return '';
  const open = src.indexOf('{', src.indexOf('=>', at));
  const close = matchBrace(src, open);
  return close < 0 ? '' : src.slice(at, close + 1);
}

const PAGE_RAW = read('marketing/portal/index.html');
const PAGE = stripHtml(PAGE_RAW);
const PAGE_JS = stripJs(PAGE);
const SETUP = stripJs(read('app/client-portal-setup.tsx'));
const EMAIL = stripJs(read('utils/emailService.ts'));
ok('the client page, the setup screen and the email service load',
  PAGE.length > 100_000 && SETUP.length > 10_000 && EMAIL.length > 1_000);

type SnapMod = typeof import('../utils/portalSnapshot');
const S = (await import(join(ROOT, 'utils/portalSnapshot.ts'))) as SnapMod;
type GuardMod = typeof import('../supabase/functions/_shared/notifyGuards');
const NG = (await import(join(ROOT, 'supabase/functions/_shared/notifyGuards.ts'))) as GuardMod;
type SampleMod = typeof import('../utils/sampleGuard');
const SG = (await import(join(ROOT, 'utils/sampleGuard.ts'))) as SampleMod;

// ── 1. The share button never shares the key ────────────────────────────────
console.log('\n1. Share leak (marketing/portal/index.html)');
const shareTag = /<button[^>]*id="share-mageid"[^>]*>[\s\S]*?<\/button>/.exec(PAGE)?.[0] ?? '';
const shareClick = /onclick="([^"]*)"/.exec(shareTag)?.[1] ?? '';
ok('1a. the referral card has one share button (id="share-mageid") with an inline handler', shareClick.length > 20, shareTag.slice(0, 120));
ok('1a. the share handler reads nothing from the page address',
  shareClick.length > 0 && !/location|document\.URL|document\.documentURI|getPortalToken|URLSearchParams|history/.test(shareClick),
  shareClick);
const sharedUrl = /var u='([^']*)'/.exec(shareClick)?.[1] ?? '';
ok('1a. it shares the public MAGE ID link (https://mageid.app/…), with no key in it',
  /^https:\/\/mageid\.app\/\?ref=portal&/.test(sharedUrl) && !/[?&]t=|token|portal\//.test(sharedUrl), sharedUrl);
ok('1a. the button is labelled for what it shares ("Share MAGE ID"), never "Share this portal"',
  />\s*Share MAGE ID\s*</.test(shareTag) && !/Share this portal/.test(PAGE));
const cardCopy = /<div class="referral-cta"[\s\S]*?<\/div>\s*<div style="display:flex/.exec(PAGE)?.[0] ?? '';
ok('1b. the card never suggests sharing the private page (no "Share it with someone")',
  cardCopy.length > 0 && !/Share it with someone|share (this|your) (portal|page)/i.test(cardCopy), cardCopy.replace(/\s+/g, ' ').slice(0, 300));

// No other control hands the address on: every navigator.share / clipboard
// write in the page is the referral button's, and every location.href READ is
// inside the print helper (writes like `location.href = mailto` are fine).
const shareCalls = (PAGE_JS.match(/navigator\.share\s*\(/g) ?? []).length;
const clipCalls = (PAGE_JS.match(/clipboard\.writeText\s*\(/g) ?? []).length;
ok('1c. the only navigator.share / clipboard.writeText on the page are the share button\'s',
  shareCalls === 1 && clipCalls === 1 && /navigator\.share\s*\(/.test(shareClick) && /clipboard\.writeText\s*\(/.test(shareClick),
  `navigator.share ×${shareCalls}, clipboard.writeText ×${clipCalls}`);
const hideFn = liftFunction(PAGE_JS, 'hideKeyFromAddress');
const restoreFn = liftFunction(PAGE_JS, 'restoreKeyToAddress');
const withoutPrintHelper = PAGE_JS.replace(hideFn, '').replace(restoreFn, '');
const hrefReads = [...withoutPrintHelper.matchAll(/location\.href(?!\s*=[^=])/g)].map(m => withoutPrintHelper.slice(Math.max(0, m.index! - 50), m.index! + 30));
ok('1c. no other code on the page reads location.href (it carries the key)', hrefReads.length === 0, hrefReads.join(' | '));
const directKeyReads = (PAGE_JS.match(/URLSearchParams\(window\.location\.search\)\.get\('t'\)/g) ?? []).length;
ok('1c. the key is read from the address only by getPortalToken() and the load-time read it falls back on (2 sites)',
  directKeyReads === 2, `${directKeyReads} direct ?t= reads`);
ok('1c. mailto: links on the page carry no address and no key',
  [...PAGE_JS.matchAll(/mailto:[^'"`]*/g)].every(m => !/location|getPortalToken|[?&]t=/.test(m[0])));

// The key never prints: run the page's own helpers.
const keyAtLoad = /var PORTAL_KEY_AT_LOAD = \(function \(\) \{[\s\S]*?\}\)\(\);/.exec(PAGE_JS)?.[0] ?? '';
const tokenFn = liftFunction(PAGE_JS, 'getPortalToken');
ok('1d. the print helpers and the load-time key read exist', !!hideFn && !!restoreFn && !!keyAtLoad && !!tokenFn);
{
  const start = 'https://mageid.app/portal/portal-abc?t=SECRETKEY123&inviteId=inv-9#top';
  const loc = { href: start, search: '?t=SECRETKEY123&inviteId=inv-9' };
  const history = {
    state: null,
    replaceState(_s: unknown, _t: string, url: string) {
      const u = new URL(url, 'https://mageid.app');
      loc.href = u.href; loc.search = u.search;
    },
  };
  const ctx = vm.createContext({ window: { location: loc }, history, URL, URLSearchParams });
  let ran = true;
  try {
    vm.runInContext(`${keyAtLoad}\n${tokenFn}\n${hideFn}\n${restoreFn}\nvar addressWithKey = null;`, ctx);
  } catch (e) { ran = false; console.log('      ', String(e)); }
  const call = (expr: string) => vm.runInContext(expr, ctx);
  if (ran) {
    call('hideKeyFromAddress()');
    ok('1d. during a print the address has no ?t= key', !/[?&]t=|SECRETKEY123/.test(loc.href), loc.href);
    ok('1d. …and keeps everything else (path, inviteId, #hash)', loc.href === 'https://mageid.app/portal/portal-abc?inviteId=inv-9#top', loc.href);
    ok('1d. …while every read on the page still gets the key (load-time copy)', call('getPortalToken()') === 'SECRETKEY123');
    call('hideKeyFromAddress()');
    call('restoreKeyToAddress()');
    ok('1d. after the print the address is exactly what it was (a second hide is a no-op)', loc.href === start, loc.href);
    call('restoreKeyToAddress()');
    ok('1d. a restore with nothing hidden changes nothing', loc.href === start, loc.href);
  } else {
    ok('1d. the lifted print helpers run', false);
  }
}
ok('1d. beforeprint hides the key and afterprint puts it back',
  /addEventListener\('beforeprint',\s*hideKeyFromAddress\)/.test(PAGE_JS) && /addEventListener\('afterprint',\s*restoreKeyToAddress\)/.test(PAGE_JS));
const prints = [...PAGE_JS.matchAll(/window\.print\(\)/g)].map(m => PAGE_JS.slice(Math.max(0, m.index! - 60), m.index!));
ok('1d. each of the page\'s own Print buttons hides the key first', prints.length >= 2 && prints.every(p => /hideKeyFromAddress\(\);\s*$/.test(p)),
  prints.map(p => p.replace(/\s+/g, ' ')).join(' | '));

// ── 2. Reset link ───────────────────────────────────────────────────────────
console.log('\n2. Reset link (app/client-portal-setup.tsx)');
const MIG = read('supabase/migrations/20260923170000_rls_hardening.sql') + read('supabase/migrations/20260904100800_portal_token_expiry_and_rotation.sql');
ok('2a. the RPC exists live-side as portal_rotate_access_token(p_project_id uuid), for signed-in owners only',
  /create or replace function public\.portal_rotate_access_token\(p_project_id uuid\)/.test(MIG)
  && /grant\s+execute on function public\.portal_rotate_access_token\(uuid\) to authenticated/.test(MIG)
  && /revoke execute on function public\.portal_rotate_access_token\(uuid\) from public, anon;/.test(MIG));
const rpcSites = [...SETUP.matchAll(/supabase\.rpc\(\s*'portal_rotate_access_token'/g)].length;
ok('2b. the screen calls it exactly once, by project id', rpcSites === 1
  && /supabase\.rpc\(\s*'portal_rotate_access_token'\s*,\s*\{\s*p_project_id:\s*id\s*\}\s*\)/.test(SETUP), `${rpcSites} call sites`);
const perform = liftCallback(SETUP, 'performLinkReset');
const askReset = liftCallback(SETUP, 'handleResetLink');
ok('2b. the call lives in performLinkReset', perform.includes("'portal_rotate_access_token'"));
const performRefs = [...SETUP.matchAll(/performLinkReset\b/g)].length;
ok('2c. performLinkReset runs only from the confirm\'s "Reset link" button', performRefs === 3
  && /\{\s*text:\s*'Reset link',\s*style:\s*'destructive',\s*onPress:\s*\(\)\s*=>\s*\{\s*void performLinkReset\(\);\s*\}\s*\}/.test(askReset),
  `${performRefs} references (declaration, deps-free call in the confirm, and the confirm's dependency list expected)`);
ok('2c. the confirm says what happens, in the spec\'s words',
  /showAlert\(\s*'Reset the link\?',\s*'Your client’s old link stops working\. Send them the new one\.'/.test(askReset));
const offlineAt = askReset.search(/isOfflineNow\(\)/);
const confirmAt = askReset.search(/showAlert\(\s*'Reset the link\?'/);
ok('2d. offline: refused before the confirm, and it says why (never queued)',
  offlineAt >= 0 && confirmAt > offlineAt && /needs a connection/.test(askReset) && /never saved to send later|never queued/.test(askReset));
ok('2d. the reset never goes through the offline queue', !/supabaseWrite|enqueue|offlineQueue/.test(perform) && /isOfflineNow\(\)/.test(perform));
ok('2e. a failed or empty answer changes nothing and says the old link still works',
  /if\s*\(\s*error\s*\|\|\s*typeof data !== 'string'\s*\|\|\s*!data\s*\)/.test(perform) && /old link still works/.test(perform));
ok('2e. the fresh key is adopted locally AND on the saved portal (the RPC\'s contract: replace it before the next sync)',
  /const adoptRotated = \(serverToken: string\) =>/.test(perform)
  && /setPortal\(p => \(\{ \.\.\.p, accessToken: serverToken \}\)\)/.test(perform)
  && /updateProject\(id, \{ clientPortal: \{ \.\.\.saved, accessToken: serverToken \} \}\)/.test(perform)
  && /adoptRotated\(data\)/.test(perform));
ok('2f. then it offers to send the new link through the existing send flow',
  /text:\s*'Send new link'/.test(perform) && /handleShareRef\.current\(\)/.test(perform) && /handleShareRef\.current = handleShare;/.test(SETUP));
ok('2g. owner only, saved portal only, never on a sample',
  /if \(warnIfSample\(\)\) return;/.test(askReset) && /ownerOnlyReason/.test(askReset) && /project\?\.clientPortal\?\.enabled/.test(askReset));
ok('2h. the button is on the screen', /testID="portal-reset-link-btn"/.test(SETUP) && /onPress=\{handleResetLink\}/.test(SETUP));
ok('2i. the client page\'s "may have reset the link" screen is now true (copy kept)', /Your contractor may have reset the link/.test(PAGE));
ok('2j. "Remove" no longer claims it cuts off access (one link per project)',
  !/This client can no longer open the portal/.test(SETUP) && /Reset link/.test(liftCallback(SETUP, 'handleRemoveInvite')));

// ── 3. Passcode: the client box accepts what the GC can set ─────────────────
console.log('\n3. Passcode rule');
ok('3a. the shared rule is 4 to 20 characters', S.PORTAL_PASSCODE_MIN_LENGTH === 4 && S.PORTAL_PASSCODE_MAX_LENGTH === 20);
const gateTag = /<input id="gate-input"[^>]*>/.exec(PAGE)?.[0] ?? '';
ok('3b. the client box takes up to PORTAL_PASSCODE_MAX_LENGTH characters', new RegExp(`maxlength="${S.PORTAL_PASSCODE_MAX_LENGTH}"`).test(gateTag), gateTag);
ok('3b. …letters included: a text box, no digit pattern, no number pad',
  /type="text"/.test(gateTag) && !/inputmode="numeric"|pattern=|type="tel"|type="number"/.test(gateTag), gateTag);
ok('3b. …and no auto-capital or autocorrect to change what the client types',
  /autocapitalize="off"/.test(gateTag) && /autocorrect="off"/.test(gateTag) && /spellcheck="false"/.test(gateTag));
const gateCopy = /<div id="gate"[\s\S]*?<\/div>\s*<\/div>/.exec(PAGE)?.[0] ?? '';
ok('3c. the gate never asks for a "4-digit code"', gateCopy.length > 0 && !/4-digit|digit code/.test(gateCopy));
const runGate = liftFunction(PAGE_JS, 'runGate');
ok('3d. the gate sends what was typed (trimmed), never filtered to digits',
  /var entered = String\(input\.value\)\.trim\(\);/.test(runGate) && !/replace\(\/\\D|\[0-9\]|\\d\{4\}/.test(runGate));
const passFn = read('supabase/functions/validate-portal-passcode/index.ts');
ok('3d. the server check is unchanged: any string, constant-time compare', /constantTimeEqual\(passcode, portal\.passcode\)/.test(passFn) && !/\\d\{4\}/.test(passFn));
ok('3e. the GC field caps at the same constant', /maxLength=\{PORTAL_PASSCODE_MAX_LENGTH\}/.test(SETUP) && !/maxLength=\{20\}/.test(SETUP));
ok('3e. the GC hint states the real rule from the constants (no "4 to 12")',
  /`Passcode \(\$\{PORTAL_PASSCODE_MIN_LENGTH\} to \$\{PORTAL_PASSCODE_MAX_LENGTH\} characters\)`/.test(SETUP) && !/4 to 12/.test(SETUP));
ok('3e. Save checks the same minimum, and saves the code trimmed (the server compares the trimmed entry)',
  /portal\.passcode\.trim\(\)\.length < PORTAL_PASSCODE_MIN_LENGTH/.test(SETUP) && /passcode: portal\.passcode\.trim\(\)/.test(liftCallback(SETUP, 'handleSave')));

// ── 4. Nothing false on the page or in the invites ──────────────────────────
console.log('\n4. Honest statements');
ok('4a. no "contractor was notified" anywhere on the client page (code and markup)', !/contractor (was|has been|is) notified/i.test(PAGE_JS));
ok('4a. the heart says it is private', /Only you can see this/.test(PAGE_JS));
ok('4a. the dead portal_reaction call is gone', !/'portal_reaction'/.test(PAGE_JS) && !/function fireReactionEvent/.test(PAGE_JS));
const notifyCalls = [...PAGE_JS.matchAll(/notifyEvent\(([^,)]*)/g)].map(m => m[1].trim()).filter(a => !/^eventName$/.test(a));
const literalEvents = notifyCalls.map(a => /^'([a-z_]+)'$/.exec(a)?.[1] ?? null);
ok('4b. every notify the page sends is one the notify function accepts from the page (literal, allow-listed)',
  notifyCalls.length >= 2 && literalEvents.every(e => e !== null && NG.ANON_ALLOWED_EVENTS.has(e)),
  `notifyEvent args: ${notifyCalls.join(', ')}`);
const pageNotifyFetches = [...PAGE_JS.matchAll(/functions\/v1\/notify/g)].length;
ok('4b. notifyEvent() is the page\'s only way to reach notify', pageNotifyFetches === 1, `${pageNotifyFetches} notify fetches`);

// Invite sections: only what is switched on.
const ALL_OFF = { showSchedule: false, showBudgetSummary: false, showInvoices: false, showChangeOrders: false, showPhotos: false, showDailyReports: false, showPunchList: false, showRFIs: false, showDocuments: false };
ok('4c. nothing switched on → no sections promised', S.portalInviteSectionNouns(ALL_OFF).length === 0);
ok('4c. photos only → "site photos" only', JSON.stringify(S.portalInviteSectionNouns({ ...ALL_OFF, showPhotos: true })) === '["site photos"]');
ok('4c. change orders without signing are not offered for sign-off',
  JSON.stringify(S.portalInviteSectionNouns({ ...ALL_OFF, showChangeOrders: true, coApprovalEnabled: false })) === '["change orders"]'
  && JSON.stringify(S.portalInviteSectionNouns({ ...ALL_OFF, showChangeOrders: true, coApprovalEnabled: true })) === '["change orders to review and sign"]');
ok('4c. signing on with change orders hidden promises nothing', S.portalInviteSectionNouns({ ...ALL_OFF, coApprovalEnabled: true }).length === 0);
const every = S.portalInviteSectionNouns({ showSchedule: true, showBudgetSummary: true, showInvoices: true, showChangeOrders: true, showPhotos: true, showDailyReports: true, showPunchList: true, showRFIs: true, showDocuments: true });
ok('4c. every switch → each section once', every.length === 9 && new Set(every).size === 9, JSON.stringify(every));
ok('4c. the sentence lists them in plain English', S.portalInviteSectionsSentence({ ...ALL_OFF, showPhotos: true, showSchedule: true, showInvoices: true }) === 'site photos, the schedule and invoices'
  && S.portalInviteSectionsSentence({ ...ALL_OFF, showPhotos: true }) === 'site photos'
  && S.portalInviteSectionsSentence(ALL_OFF) === '');
ok('4c. the invite email uses it, on the SAVED portal (what the client will actually see)',
  /portalInviteSectionsSentence\(livePortal\)/.test(liftCallback(SETUP, 'handleEmailInvite'))
  && /const livePortal = publishPortal \?\? portal;/.test(SETUP)
  && !/daily updates, photos, budget, schedule, contract/.test(SETUP));
ok('4c. the shared invite email lists the saved portal\'s sections too',
  /PERMISSION_TOGGLES\s*\.filter\(t => !!livePortal\[t\.key\]\)/.test(SETUP));

// Fallback (mail app) invite: a passcode is mentioned when set, never printed.
{
  const base = { firstName: 'Meredith', projectName: 'Harlow Residence', link: 'https://mageid.app/portal/p?t=k', companyName: 'Northline Builders' };
  const on = S.portalInviteFallbackText({ ...base, passcodeOn: true });
  const off = S.portalInviteFallbackText({ ...base, passcodeOn: false });
  ok('4d. passcode set → the fallback email says the portal asks for one, sent separately', /passcode/i.test(on) && /separate/i.test(on), on);
  ok('4d. passcode set → it never says "no password"', !/no password/i.test(on), on);
  ok('4d. the builder cannot print the code: it takes no passcode argument', !/passcode\s*[:?]?\s*string/i.test(liftFunction(read('utils/portalSnapshot.ts'), 'portalInviteFallbackText').split(')')[0]));
  ok('4d. no passcode → no passcode talk', !/passcode/i.test(off), off);
  ok('4d. both carry the link and the company', on.includes(base.link) && off.includes(base.link) && on.includes(base.companyName));
  ok('4d. the screen uses it with the passcode state, not the code',
    /portalInviteFallbackText\(\{[\s\S]*?passcodeOn:\s*!!\(livePortal\.requirePasscode && livePortal\.passcode\)/.test(SETUP)
    && !/no password to remember/.test(SETUP));
}
ok('4e. the invite email no longer promises "within seconds"', !/within seconds/.test(EMAIL));
ok('4e. …it says when things actually show up (next open or refresh)', /next time you open or refresh/.test(EMAIL));
ok('4e. the invite no longer promises "the life of the project" for a link that can expire or be reset',
  !/stays at this URL for the life of the project/.test(SETUP));

// ── 5. Sample projects never get a portal ───────────────────────────────────
console.log('\n5. Sample guard');
ok('5a. the shared definition still holds', SG.isSampleProject({ name: 'Sample — Harlow' }) && !SG.isSampleProject({ name: 'Harlow' }));
ok('5b. the screen uses isSampleProject from utils/sampleGuard', /import \{ isSampleProject \} from '@\/utils\/sampleGuard';/.test(SETUP)
  && /const sampleJob = !!project && isSampleProject\(project\);/.test(SETUP));
for (const h of ['handleSave', 'handleCopyLink', 'handleShare', 'handleEmailInvite', 'handleGenerateLink', 'handleResetLink']) {
  const body = liftCallback(SETUP, h);
  const guardAt = body.search(/if \(warnIfSample\(\)\) return;/);
  const firstEffect = body.search(/updateProject\(|copyToClipboard\(|setShowSendModal\(|sendEmail\(|supabase\.|showAlert\('(?!Sample)/);
  ok(`5c. ${h} refuses a sample before it does anything`, guardAt >= 0 && (firstEffect === -1 || guardAt < firstEffect), `guard at ${guardAt}, first effect at ${firstEffect}`);
}
const publishEffect = SETUP.slice(SETUP.indexOf("from('portal_snapshots')") - 2500, SETUP.indexOf("from('portal_snapshots')"));
ok('5d. a sample\'s snapshot is never published', /if \(sampleJob\) return;/.test(publishEffect));
ok('5e. the screen says why, at the top', /testID="portal-setup-sample"/.test(SETUP) && /SAMPLE_PORTAL_NOTE/.test(SETUP));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
