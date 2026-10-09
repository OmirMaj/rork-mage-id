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
//   2. RESET LINK. The GC can cut off a leaked link: "Reset Link" calls the live
//      owner-only RPC portal_rotate_access_token, confirms first, refuses
//      offline (never queued — it changes who can open the portal), adopts the
//      fresh key and offers to send the new link. It NEVER GUESSES: when the
//      call does not come back clean it reads the server's key and says only
//      what that proves — reset (a different key), not reset (the same key),
//      or not confirmed (the read failed too; the held key is dropped).
//   3. PASSCODE LOCKOUT. The client's passcode box took 4 digits on a number
//      pad; the GC can set 4 to 20 characters with letters. Both sides now read
//      the same rule (PORTAL_PASSCODE_MIN_LENGTH / _MAX_LENGTH).
//   4. FALSE STATEMENTS. No "Your contractor was notified." for an event the
//      notify function refuses from the page; no dead notify calls; the invite
//      fallback says a passcode exists when one is set (never the code itself);
//      invites list only the sections switched on; no "within seconds".
//   5. SAMPLE GUARD. utils/sampleGuard.ts promises "no client-portal post", so
//      a Sample project can't save, share, publish or reset a portal — on the
//      setup screen, at the project page's Enable button, and in every lite
//      publisher (the shared syncPortalSnapshotLite is RUN here on a sample).
//
// HOW IT CHECKS. The page is static HTML and the screen imports react-native,
// so most checks read COMMENT-STRIPPED source; the page's own key helpers, its
// passcode gate (runGate) and its heart (wireActivityReactions) are lifted and
// EXECUTED in a vm against a fake page, and the pure invite / passcode /
// reset-outcome helpers in utils/portalSnapshot.ts and the lite publisher in
// utils/portalLiteSync.ts are imported and run.
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
type LiteMod = typeof import('../utils/portalLiteSync');
const LS = (await import(join(ROOT, 'utils/portalLiteSync.ts'))) as LiteMod;
const DETAIL = stripJs(read('app/project-detail.tsx'));
const CONTEXT = stripJs(read('contexts/ProjectContext.tsx'));
const LITE = stripJs(read('utils/portalLiteSync.ts'));
const CONTRACT = stripJs(read('app/contract.tsx'));
const SNAP_SRC = stripJs(read('utils/portalSnapshot.ts'));

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
ok('1a. the button is labeled for what it shares ("Share MAGE ID"), never "Share this portal"',
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
ok('2c. performLinkReset runs only from the confirm\'s "Reset Link" button', performRefs === 3
  && /\{\s*text:\s*'Reset Link',\s*style:\s*'destructive',\s*onPress:\s*\(\)\s*=>\s*\{\s*void performLinkReset\(\);\s*\}\s*\}/.test(askReset),
  `${performRefs} references (declaration, deps-free call in the confirm, and the confirm's dependency list expected)`);
ok('2c. the confirm says what happens, in the spec\'s words',
  /showAlert\(\s*'Reset the link\?',\s*'Your client’s old link stops working\. Send them the new one\.'/.test(askReset));
const offlineAt = askReset.search(/isOfflineNow\(\)/);
const confirmAt = askReset.search(/showAlert\(\s*'Reset the link\?'/);
ok('2d. offline: refused before the confirm, and it says why (never queued)',
  offlineAt >= 0 && confirmAt > offlineAt && /needs a connection/.test(askReset) && /never saved to send later|never queued/.test(askReset));
ok('2d. the reset never goes through the offline queue', !/supabaseWrite|enqueue|offlineQueue/.test(perform) && /isOfflineNow\(\)/.test(perform));
// 2e. RESET LINK NEVER GUESSES (decision D1). The rotate commits on the server
// before its answer travels, so "no clean answer" proves nothing about the old
// link. The rule is one pure function; it is RUN here.
{
  const R = S.portalResetOutcome;
  const kind = (held: string | null | undefined, rb: Parameters<typeof R>[1]) => R(held, rb).kind;
  const reset = R('OLDKEY', { ok: true, token: 'NEWKEY' });
  ok('2e. server holds a DIFFERENT key → the reset happened, and the new key is the server\'s',
    reset.kind === 'reset' && reset.token === 'NEWKEY', JSON.stringify(reset));
  ok('2e. server holds the SAME key → the reset did not happen', kind('OLDKEY', { ok: true, token: 'OLDKEY' }) === 'not-reset');
  ok('2e. the read-back failed → unknown (never "still works", never "reset")', kind('OLDKEY', { ok: false }) === 'unknown');
  ok('2e. the read-back came back empty → unknown', kind('OLDKEY', { ok: true, token: null }) === 'unknown' && kind('OLDKEY', { ok: true, token: '' }) === 'unknown');
  ok('2e. no key was held to compare with → unknown, whatever the server says',
    kind('', { ok: true, token: 'NEWKEY' }) === 'unknown' && kind(null, { ok: true, token: 'NEWKEY' }) === 'unknown' && kind(undefined, { ok: false }) === 'unknown');
}
const settle = liftCallback(SETUP, 'settleResetFromServer');
const forget = liftCallback(SETUP, 'forgetHeldKey');
const adopt = liftCallback(SETUP, 'adoptRotated');
const announce = liftCallback(SETUP, 'announceLinkReset');
/** The `{ ... }` block that follows `if (outcome.kind === '<k>')` in `settle`. */
function outcomeBlock(k: string): string {
  const at = settle.indexOf(`if (outcome.kind === '${k}')`);
  if (at < 0) return '';
  const open = settle.indexOf('{', at);
  const close = matchBrace(settle, open);
  return close < 0 ? '' : settle.slice(open, close + 1);
}
const resetBlock = outcomeBlock('reset');
const notResetBlock = outcomeBlock('not-reset');
const unknownTail = settle.slice(settle.indexOf(notResetBlock) + notResetBlock.length);
ok('2e. "still works" is said by ONE string, and only that one (PORTAL_RESET_NOT_RESET_NOTE)',
  /old link still works/.test(S.PORTAL_RESET_NOT_RESET_NOTE)
  && (SNAP_SRC.match(/still works/g) ?? []).length === 1
  && !/still works|still opens/i.test(settle + forget + adopt + announce)
  && !/still works/i.test(SETUP),
  `portalSnapshot ×${(SNAP_SRC.match(/still works/g) ?? []).length}`);
ok('2e. …and the "not confirmed" string claims neither outcome: may have stopped working, look again before sending',
  !/still works|has been reset|(?<!whether the link )was reset/i.test(S.PORTAL_RESET_UNKNOWN_NOTE)
  && /couldn.t confirm whether the link was reset/i.test(S.PORTAL_RESET_UNKNOWN_NOTE)
  && /may have stopped working/i.test(S.PORTAL_RESET_UNKNOWN_NOTE)
  && /Open this screen again/.test(S.PORTAL_RESET_UNKNOWN_NOTE) && /before you send anything/.test(S.PORTAL_RESET_UNKNOWN_NOTE),
  S.PORTAL_RESET_UNKNOWN_NOTE);
const notResetUses = (SETUP.match(/PORTAL_RESET_NOT_RESET_NOTE/g) ?? []).length;
ok('2e. the screen says "still works" in exactly one place: the server-proven \'not-reset\' branch',
  notResetUses === 2 && /showAlert\('Link Not Reset', PORTAL_RESET_NOT_RESET_NOTE\)/.test(notResetBlock),
  `${notResetUses} references (the import and the one branch expected)`);
const readAt = settle.search(/readBack = await readServerPortalToken\(id\)/);
const decideAt = settle.search(/const outcome = portalResetOutcome\(heldBefore, readBack\)/);
ok('2e. that branch is reachable only AFTER a read of the server\'s key (read → decide → say)',
  readAt >= 0 && decideAt > readAt && settle.indexOf(notResetBlock) > decideAt
  && /let readBack: PortalKeyReadBack = \{ ok: false \};/.test(settle), `read ${readAt}, decide ${decideAt}`);
ok('2e. a different key: the screen adopts it and offers the New Link',
  /adoptRotated\(outcome\.token\);/.test(resetBlock) && /announceLinkReset\(\);/.test(resetBlock));
ok('2e. not confirmed: the held key is dropped first, then only what is known is said',
  /forgetHeldKey\(\);\s*showAlert\('Reset Not Confirmed', PORTAL_RESET_UNKNOWN_NOTE\);/.test(unknownTail)
  && !/PORTAL_RESET_NOT_RESET_NOTE|adoptRotated|announceLinkReset/.test(unknownTail), unknownTail.replace(/\s+/g, ' ').slice(0, 200));
ok('2e. dropping the key takes it off the screen AND the saved copy, and re-runs the server fetch (Copy / Share lock on a missing key)',
  /const \{ accessToken: _held, \.\.\.savedWithoutKey \} = saved;/.test(forget)
  && /updateProject\(id, \{ clientPortal: savedWithoutKey \}\)/.test(forget)
  && /setPortal\(p => \{ const \{ accessToken: _shown, \.\.\.rest \} = p; return rest; \}\)/.test(forget)
  && /retryTokenHeal\(\);/.test(forget)
  && /const linkPending = portal\.enabled && !portal\.accessToken;/.test(SETUP));
ok('2e. performLinkReset states no outcome of its own on a call that did not come back clean: it hands over to the read-back',
  /if \(!error && typeof data === 'string' && data\) rotated = data;/.test(perform)
  && /\} catch \{\s*\}\s*if \(rotated\) \{\s*adoptRotated\(rotated\);\s*announceLinkReset\(\);\s*return;\s*\}\s*await settleResetFromServer\(heldBefore\);/.test(perform)
  && !/Link not reset|PORTAL_RESET_/.test(perform),
  perform.replace(/\s+/g, ' ').slice(-420));
ok('2e. the key held BEFORE the call is what the server\'s key is compared with',
  /const heldBefore = portal\.accessToken \|\| project\.clientPortal\.accessToken \|\| '';/.test(perform)
  && perform.indexOf('const heldBefore') < perform.indexOf("supabase.rpc("));
ok('2e. nothing in the reset path is queued for later', !/supabaseWrite|enqueue|offlineQueue/.test(perform + settle + forget + adopt));
ok('2e. the fresh key is adopted on screen AND on the saved portal (the RPC\'s contract: replace it before the next sync)',
  /setPortal\(p => \(\{ \.\.\.p, accessToken: serverToken \}\)\)/.test(adopt)
  && /updateProject\(id, \{ clientPortal: \{ \.\.\.saved, accessToken: serverToken \} \}\)/.test(adopt));
ok('2f. then it offers to send the new link through the existing send flow',
  /text:\s*'Send New Link'/.test(announce) && /handleShareRef\.current\(\)/.test(announce) && /handleShareRef\.current = handleShare;/.test(SETUP));
ok('2f. no second reset on top of an unconfirmed one: with no key on the device, Reset stops at the same "link pending" guard as Copy / Share',
  askReset.search(/if \(warnIfLinkPending\(\)\) return;/) >= 0 && askReset.search(/if \(warnIfLinkPending\(\)\) return;/) < confirmAt);
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
ok('3b. a minlength on the box, if any, is the shared minimum', !/minlength=/.test(gateTag) || new RegExp(`minlength="${S.PORTAL_PASSCODE_MIN_LENGTH}"`).test(gateTag), gateTag);
const gateRefsElsewhere = (PAGE_JS.replace(runGate, '').replace(gateTag, '').match(/gate-input/g) ?? []).length;
ok('3d. the box is touched by runGate alone (nothing else on the page reaches #gate-input)',
  runGate.includes("document.getElementById('gate-input')") && gateRefsElsewhere === 0, `${gateRefsElsewhere} references outside the tag and runGate`);

// 3f. RUN the page's own gate against a fake page: whatever the GC can set
// (PORTAL_PASSCODE_MIN_LENGTH to _MAX_LENGTH characters, letters, symbols,
// inner spaces) must leave the box exactly as typed and reach the check
// verbatim. A length or character rule added to the gate's JavaScript — in
// attempt(), or as a listener that rewrites the box — turns these red.
type GateRun = { ran: boolean; listenerTypes: string[]; valueAfterTyping: string; posts: { url: string; body: Record<string, unknown> }[]; passed: number; err: string; gateShown: string };
async function runPageGate(typed: string, opts: { legacy?: string; via: 'click' | 'enter' }): Promise<GateRun> {
  const out: GateRun = { ran: false, listenerTypes: [], valueAfterTyping: '', posts: [], passed: 0, err: '', gateShown: '' };
  type Fn = (e: unknown) => void;
  const inputL: Record<string, Fn[]> = {};
  const btnL: Record<string, Fn[]> = {};
  const input = { value: '', focus() { /* no-op */ }, addEventListener(t: string, f: Fn) { (inputL[t] ??= []).push(f); } };
  const btn = { disabled: false, style: {} as Record<string, string>, addEventListener(t: string, f: Fn) { (btnL[t] ??= []).push(f); } };
  const gateEl = { style: { display: 'none' } };
  const errEl = { textContent: '' };
  const els: Record<string, unknown> = { gate: gateEl, 'gate-input': input, 'gate-submit': btn, 'gate-err': errEl };
  const store = new Map<string, string>();
  const ctx = vm.createContext({
    document: { getElementById: (id: string) => els[id] ?? null },
    sessionStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, String(v)); } },
    fetch: (url: string, init: { body: string }) => { out.posts.push({ url, body: JSON.parse(init.body) }); return Promise.resolve({ ok: true, status: 200 }); },
  });
  try {
    vm.runInContext(runGate, ctx);
    const data = {
      requirePasscode: true, project: { id: 'p1' },
      ...(opts.legacy !== undefined ? { passcode: opts.legacy } : {}),
      portalApi: { supabaseUrl: 'https://x.supabase.co/', supabaseAnonKey: 'anon', portalId: 'portal-1' },
    };
    (ctx as unknown as { runGate: (d: unknown, onPass: () => void) => void }).runGate(data, () => { out.passed++; });
    out.ran = true;
  } catch (e) { console.log('      ', String(e)); return out; }
  out.gateShown = gateEl.style.display;
  input.value = typed;
  // Everything the page hung on the box, fired the way typing fires it.
  out.listenerTypes = Object.keys(inputL).sort();
  for (const t of out.listenerTypes) for (const f of inputL[t]) f({ type: t, key: 'a', target: input, preventDefault() { /* no-op */ } });
  out.valueAfterTyping = input.value;
  if (opts.via === 'click') for (const f of btnL.click ?? []) f({ type: 'click' });
  else for (const f of inputL.keydown ?? []) f({ type: 'keydown', key: 'Enter', target: input });
  for (let i = 0; i < 5; i++) await Promise.resolve();
  out.err = errEl.textContent;
  return out;
}
{
  const MIN = S.PORTAL_PASSCODE_MIN_LENGTH;
  const MAX = S.PORTAL_PASSCODE_MAX_LENGTH;
  const shortest = 'abcd'.padEnd(MIN, 'x').slice(0, MIN);
  const longest = 'Harlow-Job-2026-abcd'.padEnd(MAX, 'z').slice(0, MAX);
  const codes: [string, string][] = [
    [`the shortest the GC can set (${MIN} letters)`, shortest],
    [`the longest the GC can set (${MAX} characters, letters, digits, dashes)`, longest],
    ['letters, a symbol and an inner space', 'Ab 9!z'],
    ['digits only (the old rule still works)', '4821'],
  ];
  ok('3f. the page\'s runGate lifts', runGate.length > 200 && shortest.length === MIN && longest.length === MAX);
  for (const [label, code] of codes) {
    for (const via of ['click', 'enter'] as const) {
      const r = await runPageGate(code, { via });
      ok(`3f. ${label}, ${via === 'click' ? 'Unlock button' : 'Enter key'}: the box keeps it and the check receives it verbatim`,
        r.ran && r.gateShown === 'flex' && r.valueAfterTyping === code
        && r.posts.length === 1 && r.posts[0].body.passcode === code && r.posts[0].body.portalId === 'portal-1'
        && /\/functions\/v1\/validate-portal-passcode$/.test(r.posts[0].url)
        && r.passed === 1 && r.err === '',
        JSON.stringify({ kept: r.valueAfterTyping, posts: r.posts.map(x => x.body), passed: r.passed, err: r.err }));
    }
  }
  const idle = await runPageGate(longest, { via: 'click' });
  ok('3f. the only thing the page listens for on the box is the Enter key (no listener that rewrites what is typed)',
    idle.ran && JSON.stringify(idle.listenerTypes) === '["keydown"]', JSON.stringify(idle.listenerTypes));
  const padded = await runPageGate(`  ${longest} `, { via: 'click' });
  ok('3f. spaces around the code are dropped, exactly as the app saves it (trimmed)', padded.posts.length === 1 && padded.posts[0].body.passcode === longest);
  const legacyOk = await runPageGate(longest, { via: 'click', legacy: ` ${longest} ` });
  const legacyBad = await runPageGate(`${longest.slice(0, -1)}X`, { via: 'click', legacy: longest });
  ok('3f. an old link that still carries its code: the same code unlocks, a wrong one does not, neither calls the server',
    legacyOk.passed === 1 && legacyOk.posts.length === 0 && legacyBad.passed === 0 && legacyBad.posts.length === 0 && /Incorrect passcode/.test(legacyBad.err));
}
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
// The heart, RUN: every label it can show — already liked, not liked, after a
// tap, after a second tap — says it is private and names nobody else, and a
// tap sends nothing anywhere. This pins what the label MEANS, not a spelling.
{
  const wire = liftFunction(PAGE_JS, 'wireActivityReactions');
  type Fn = (e: unknown) => void;
  const made: { title: string; attrs: Record<string, string>; fire: () => void }[] = [];
  const sent: string[] = [];
  const store = new Map<string, string>([['portal_reactions_portal-1_1', '1']]);
  const mkButton = () => {
    const classes = new Set<string>();
    const listeners: Fn[] = [];
    const attrs: Record<string, string> = {};
    const el = {
      title: '', innerHTML: '', type: '', offsetWidth: 0, attrs,
      get className() { return [...classes].join(' '); },
      set className(v: string) { classes.clear(); for (const c of String(v).split(/\s+/).filter(Boolean)) classes.add(c); },
      classList: {
        contains: (c: string) => classes.has(c),
        add: (c: string) => { classes.add(c); },
        remove: (c: string) => { classes.delete(c); },
        toggle: (c: string, on?: boolean) => { const want = on ?? !classes.has(c); if (want) classes.add(c); else classes.delete(c); return want; },
      },
      setAttribute(k: string, v: string) { attrs[k] = String(v); },
      addEventListener(t: string, f: Fn) { if (t === 'click') listeners.push(f); },
      fire() { for (const f of listeners) f({ stopPropagation() { /* no-op */ } }); },
    };
    made.push(el);
    return el;
  };
  const rows = [{ appendChild() { /* no-op */ } }, { appendChild() { /* no-op */ } }];
  const ctx = vm.createContext({
    document: { querySelectorAll: (sel: string) => (sel === '.activity-row' ? rows : []), createElement: () => mkButton() },
    localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, String(v)); } },
    fetch: (url: string) => { sent.push(`fetch ${url}`); return Promise.resolve({ ok: true }); },
    notifyEvent: (name: string) => { sent.push(`notifyEvent ${name}`); },
    navigator: { sendBeacon: (url: string) => { sent.push(`beacon ${url}`); return true; } },
  });
  let ran = true;
  try {
    vm.runInContext(wire, ctx);
    (ctx as unknown as { wireActivityReactions: (d: unknown) => void }).wireActivityReactions({ portalApi: { portalId: 'portal-1' } });
  } catch (e) { ran = false; console.log('      ', String(e)); }
  const labels: string[] = [];
  const collect = () => { for (const b of made) { labels.push(b.title, b.attrs['aria-label'] ?? ''); } };
  if (ran) { collect(); for (const b of made) b.fire(); collect(); for (const b of made) b.fire(); collect(); }
  const PRIVATE = /only you can see/i;
  const SOMEONE_ELSE = /contractor|builder|\bteam\b|company|notif|\btold\b|\bsent\b|let .{0,20}know|shared with|everyone|anyone/i;
  const bad = labels.filter(l => !PRIVATE.test(l) || SOMEONE_ELSE.test(l));
  ok('4a. the heart runs: one button per update, liked state read from this browser only', ran && made.length === 2 && labels.length === 12, `${made.length} buttons, ${labels.length} labels`);
  ok('4a. every heart label (liked, not liked, after each tap; title and aria-label) says only the client can see it, and names nobody else',
    ran && bad.length === 0, bad.join(' | '));
  ok('4a. a tap on the heart sends nothing anywhere (a private like)', ran && sent.length === 0 && store.get('portal_reactions_portal-1_0') === '0' && store.get('portal_reactions_portal-1_1') === '1', sent.join(' | '));
}
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

// 5f–5k. THE FENCE EVERYWHERE (decision D2): no door gives a Sample project an
// enabled portal, a server key or a published snapshot.
const reasonSentences = S.SAMPLE_PORTAL_REASON.split(/(?<=\.)\s+/);
const setupNote = /const SAMPLE_PORTAL_NOTE = '([^']*)';/.exec(read('app/client-portal-setup.tsx'))?.[1].replace(/\\u2014/g, '—') ?? '';
ok('5f. one plain reason for every door: the setup screen\'s note carries every sentence of SAMPLE_PORTAL_REASON',
  reasonSentences.length === 3 && reasonSentences[0] === 'Sample job.' && /^A client portal never goes out from a sample\.$/.test(reasonSentences[1])
  && reasonSentences.every(x => setupNote.includes(x)), setupNote);
{
  const at = DETAIL.indexOf('testID="portal-enable-btn"');
  const press = at < 0 ? '' : DETAIL.slice(at, DETAIL.indexOf('activeOpacity', at));
  const guardAt = press.search(/if \(isSampleProject\(project\)\) \{ showAlert\('Sample Job', SAMPLE_PORTAL_REASON\); return; \}/);
  const writeAt = press.search(/updateProject\(/);
  ok('5g. the project page\'s Enable Client Portal button refuses a sample before any write, and says why',
    guardAt >= 0 && writeAt > guardAt && /enabled: true/.test(press)
    && /import \{ isSampleProject \} from '@\/utils\/sampleGuard';/.test(DETAIL), `guard at ${guardAt}, write at ${writeAt}`);
  const enableWrites = (DETAIL.match(/clientPortal: \{\s*enabled: true/g) ?? []).length;
  ok('5g. …and it is the page\'s only door that switches a portal on', enableWrites === 1, `${enableWrites} enabling writes in app/project-detail.tsx`);
  const callAt = DETAIL.indexOf('void syncPortalSnapshotLite(project.id');
  const effect = callAt < 0 ? '' : DETAIL.slice(DETAIL.lastIndexOf('useEffect(', callAt), callAt);
  ok('5h. the project page\'s background publish skips a sample', /if \(isSampleProject\(project\)\) return;/.test(effect)
    && (DETAIL.match(/syncPortalSnapshotLite\(/g) ?? []).length === 1);
}
{
  const callAt = CONTEXT.indexOf('await syncPortalSnapshotLite(project.id, input)');
  const loop = callAt < 0 ? '' : CONTEXT.slice(CONTEXT.lastIndexOf('for (const project of inp.projects)', callAt), callAt);
  ok('5h. the provider\'s publish pass (what requestPortalPublish schedules) skips a sample, and settles its mark',
    /if \(isSampleProject\(project\)\) \{ settle\(project\.id\); continue; \}/.test(loop)
    && (CONTEXT.match(/syncPortalSnapshotLite\(/g) ?? []).length === 1);
  const runOnceSrc = liftFunction(LITE, 'runOnce');
  const sampleAt = runOnceSrc.search(/if \(isSampleProject\(project\)\) return 'portal_off';/);
  ok('5i. the shared lite publisher refuses a sample before it reads or writes anything',
    sampleAt >= 0 && sampleAt < runOnceSrc.search(/io\.\w+\(/), `guard at ${sampleAt}, first IO at ${runOnceSrc.search(/io\.\w+\(/)}`);
}
{
  // 5i, RUN: the same job, once named as a sample and once as a real job.
  type IO = import('../utils/portalLiteSync').PortalLiteSyncIO;
  type Input = import('../utils/portalLiteSync').PortalLiteSyncInput;
  const mk = () => {
    const calls: string[] = [];
    const io: IO = {
      async loadContract() { calls.push('loadContract'); return { ok: true, value: null }; },
      async loadSelections() { calls.push('loadSelections'); return { ok: true, value: [] }; },
      async loadCloseoutBinder() { calls.push('loadCloseoutBinder'); return { ok: true, value: null }; },
      async loadPassport() { calls.push('loadPassport'); return null; },
      async readPublished() { calls.push('readPublished'); return { ok: true, value: null }; },
      async upsert() { calls.push('upsert'); return { error: null }; },
      supabaseUrl: 'https://x', supabaseAnonKey: 'k',
    };
    return { io, calls };
  };
  const input = (name: string, id: string): Input => ({
    project: {
      id, name, status: 'in_progress', ownerUserId: 'gc-1',
      clientPortal: { portalId: `portal-${id}`, enabled: true, showInvoices: true, showChangeOrders: true, showPhotos: true, showSchedule: false, showBudgetSummary: false, showDailyReports: false, showPunchList: false, showRFIs: false, showDocuments: false },
    } as unknown as Input['project'],
    userId: 'gc-1',
    settings: { branding: { companyName: 'Northline Builders' } } as unknown as Input['settings'],
    settingsLoaded: true, invoices: [], changeOrders: [], dailyReports: [], punchItems: [], photos: [], rfis: [], warranties: [], permits: [],
  });
  const sample = mk();
  const sampleOutcome = await LS.syncPortalSnapshotLite('pfx-sample', input('Sample — Sarah’s Place', 'pfx-sample'), sample.io);
  ok('5i. RUN: a sample with a portal on publishes nothing — no read, no write, outcome "portal_off" (its mark settles)',
    sampleOutcome === 'portal_off' && sample.calls.length === 0, `${sampleOutcome}; io calls: ${sample.calls.join(', ')}`);
  const real = mk();
  const realOutcome = await LS.syncPortalSnapshotLite('pfx-real', input('Sarah’s Place', 'pfx-real'), real.io);
  ok('5i. RUN: the same job under a real name publishes (the fence is the name rule, nothing else)',
    realOutcome === 'published' && real.calls.filter(c => c === 'upsert').length === 1, `${realOutcome}; io calls: ${real.calls.join(', ')}`);
}
{
  const healAt = SETUP.indexOf('const first = await readServerPortalToken(id);');
  const heal = healAt < 0 ? '' : SETUP.slice(SETUP.lastIndexOf('useEffect(', healAt), healAt);
  ok('5j. the setup screen never fetches or mints a server key for a sample', /if \(sampleJob\) return;/.test(heal)
    && heal.search(/if \(sampleJob\) return;/) < heal.search(/setTokenHeal\('working'\)/));
  const ask = liftCallback(CONTRACT, 'saveDeliveryAsk');
  ok('5k. the contract\'s Sign & send (the one other door that switches a portal on) already refuses a sample first',
    ask.search(/if \(isSampleProject\(p\)\)/) >= 0 && ask.search(/if \(isSampleProject\(p\)\)/) < ask.search(/enabled: true/));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
